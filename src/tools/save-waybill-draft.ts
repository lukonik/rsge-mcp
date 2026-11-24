import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import {
  RsgeApiError,
  translateRsgeErrorCode,
} from '../reference/index.js';
import { toArray, xmlIntSchema } from '../soap/xml.js';
import {
  buildDraftWaybillXml,
  saveWaybillDraftInputSchema,
  type SellerIdentity,
} from '../waybill/draft-builder.js';
import { formatSoapErrorResult } from './errors.js';

const optionalXmlIntSchema = z
  .union([xmlIntSchema, z.literal('')])
  .nullable()
  .optional()
  .transform((value) => (typeof value === 'number' ? value : 0));

const optionalXmlStringSchema = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) {
      return '';
    }
    return String(value).trim();
  });

const savedGoodsItemSchema = z.object({
  ID: optionalXmlIntSchema,
  ERROR: optionalXmlIntSchema,
  W_NAME: optionalXmlStringSchema,
});

const savedGoodsListSchema = z
  .union([
    z.literal(''),
    z.object({
      GOODS: z
        .union([savedGoodsItemSchema, z.array(savedGoodsItemSchema)])
        .optional(),
    }),
  ])
  .nullable()
  .optional()
  .transform((container) => {
    if (!container || typeof container !== 'object') {
      return [];
    }
    return toArray(container.GOODS);
  });

const saveWaybillResultInnerSchema = z.object({
  STATUS: xmlIntSchema,
  ID: optionalXmlIntSchema,
  WAYBILL_NUMBER: optionalXmlStringSchema,
  GOODS_LIST: savedGoodsListSchema,
});

const saveWaybillResponseSchema = z.object({
  save_waybillResult: z.object({
    RESULT: saveWaybillResultInnerSchema,
  }),
});

interface TranslatedLineItemError {
  readonly lineIndex: number;
  readonly lineItemId: number;
  readonly name?: string;
  readonly code: number;
  readonly georgianText: string;
  readonly englishText: string;
  readonly hint: string;
  readonly knownCode: boolean;
}

function extractGoodsItemsFromRawResult(
  rawResult: unknown,
): Array<{ readonly ID: number; readonly ERROR: number; readonly W_NAME: string }> {
  if (!rawResult || typeof rawResult !== 'object') {
    return [];
  }
  const resultNode = (rawResult as Record<string, unknown>).RESULT;
  if (!resultNode || typeof resultNode !== 'object') {
    return [];
  }
  const goodsListParsed = savedGoodsListSchema.safeParse(
    (resultNode as Record<string, unknown>).GOODS_LIST,
  );
  return goodsListParsed.success ? goodsListParsed.data : [];
}

async function translateLineItemErrors(
  goodsItems: ReadonlyArray<{
    readonly ID: number;
    readonly ERROR: number;
    readonly W_NAME: string;
  }>,
  context: ServerContext,
): Promise<{
  readonly primaryError: RsgeApiError | undefined;
  readonly lineItemErrors: readonly TranslatedLineItemError[];
}> {
  let primaryError: RsgeApiError | undefined;
  const lineItemErrors: TranslatedLineItemError[] = [];

  for (let index = 0; index < goodsItems.length; index += 1) {
    const item = goodsItems[index]!;
    if (item.ERROR < 0) {
      const apiError = await context.soapClient.translateErrorCode(
        item.ERROR,
        'save_waybill',
        item,
      );
      if (primaryError === undefined) {
        primaryError = apiError;
      }
      lineItemErrors.push({
        lineIndex: index,
        lineItemId: item.ID,
        ...(item.W_NAME.length > 0 ? { name: item.W_NAME } : {}),
        code: apiError.code,
        georgianText: apiError.georgianText,
        englishText: apiError.englishText,
        hint: apiError.hint,
        knownCode: apiError.knownCode,
      });
    }
  }

  return { primaryError, lineItemErrors };
}

export function registerSaveWaybillDraftTool(
  server: FastMCP,
  context: ServerContext,
): void {
  let cachedSellerIdentity: Promise<SellerIdentity> | undefined;

  async function resolveSellerIdentity(): Promise<SellerIdentity> {
    if (cachedSellerIdentity === undefined) {
      cachedSellerIdentity = context.soapClient
        .checkServiceUser()
        .then((result) => {
          if (!result.valid || result.unId <= 0 || result.serviceUserId <= 0) {
            const authCode = result.unId < 0 ? result.unId : -3;
            const translated = translateRsgeErrorCode(
              authCode,
              'chek_service_user',
            );
            throw new RsgeApiError(translated, { rawResult: result });
          }
          return Object.freeze({
            unId: result.unId,
            serviceUserId: result.serviceUserId,
          });
        })
        .catch((error: unknown) => {
          cachedSellerIdentity = undefined;
          throw error;
        });
    }

    return cachedSellerIdentity;
  }

  server.tool(
    {
      name: 'save_waybill_draft',
      title: 'შენახული ზედნადების შექმნა/რედაქტირება / Save Draft Waybill',
      description:
        'ქმნის ახალ შენახულ (Draft) ზედნადებს ან არედაქტირებს არსებულ შენახულ ზედნადებს RS.ge-ზე (save_waybill) სერვერის მხარეს ზუსტი თანხების გამოთვლით. დადასტურების ტოკენი არ სჭირდება. ' +
        'Creates a new Draft Waybill or updates an existing Draft Waybill in RS.ge (save_waybill) with server-side decimal-safe arithmetic for Line Item subtotals and FULL_AMOUNT. Executes directly without a confirmation token.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
      input: saveWaybillDraftInputSchema,
    },
    async (args) => {
      try {
        const seller = await resolveSellerIdentity();
        const built = buildDraftWaybillXml(args, seller);

        const parsed = await context.soapClient.callOperation(
          'save_waybill',
          { waybill: { rawXml: built.waybillXml } },
          saveWaybillResponseSchema,
        );

        const result = parsed.save_waybillResult.RESULT;
        const { primaryError, lineItemErrors } = await translateLineItemErrors(
          result.GOODS_LIST,
          context,
        );

        if (primaryError !== undefined) {
          return formatSoapErrorResult(primaryError, context.logger, {
            ...(result.ID > 0 ? { waybillId: result.ID } : {}),
            lineItemErrors,
          });
        }

        const isUpdate = args.waybillId > 0;
        const savedWaybillId = result.ID > 0 ? result.ID : args.waybillId;
        const waybillNumber =
          result.WAYBILL_NUMBER.length > 0 ? result.WAYBILL_NUMBER : null;

        const returnedLineItems = built.lineItems.map((item, index) => {
          const rsgeItem =
            result.GOODS_LIST.length === built.lineItems.length
              ? result.GOODS_LIST[index]
              : undefined;
          const resolvedId =
            rsgeItem && rsgeItem.ID > 0 ? rsgeItem.ID : item.id;
          return {
            ...item,
            id: resolvedId,
          };
        });

        context.logger.info('Saved RS.ge Draft Waybill', {
          waybillId: savedWaybillId,
          isUpdate,
          waybillType: args.waybillType,
          lineItemCount: returnedLineItems.length,
          fullAmount: built.fullAmountFormatted,
        });

        return {
          waybillId: savedWaybillId,
          waybillNumber,
          status: 0,
          statusName: 'შენახული',
          statusEnglishName: 'Draft',
          isUpdate,
          waybillType: args.waybillType,
          fullAmount: built.fullAmount,
          fullAmountFormatted: built.fullAmountFormatted,
          lineItems: returnedLineItems,
          message: isUpdate
            ? `შენახული ზედნადები #${savedWaybillId} წარმატებით განახლდა (ჯამი: ${built.fullAmountFormatted} ₾). ` +
              `Draft Waybill #${savedWaybillId} updated successfully (total: ${built.fullAmountFormatted} GEL).`
            : `ახალი შენახული ზედნადები #${savedWaybillId} წარმატებით შეიქმნა (ჯამი: ${built.fullAmountFormatted} ₾). ` +
              `New Draft Waybill #${savedWaybillId} created successfully (total: ${built.fullAmountFormatted} GEL).`,
        };
      } catch (error) {
        if (error instanceof RsgeApiError && error.operation === 'save_waybill') {
          const goodsItems = extractGoodsItemsFromRawResult(error.rawResult);
          const { lineItemErrors } = await translateLineItemErrors(
            goodsItems,
            context,
          );
          if (lineItemErrors.length > 0) {
            return formatSoapErrorResult(error, context.logger, {
              lineItemErrors,
            });
          }
        }
        return formatSoapErrorResult(error, context.logger);
      }
    },
  );
}
