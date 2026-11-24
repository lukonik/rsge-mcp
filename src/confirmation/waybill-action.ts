import type { ToolResult } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import type { RsgeLogger } from '../logger.js';
import { formatSoapErrorResult, toolErrorResult } from '../tools/errors.js';
import { waybillIdSchema } from '../validation/common.js';
import { fetchWaybillById, type Waybill } from '../waybill/index.js';
import type { ConsumeConfirmationResult } from './store.js';

export interface BilingualLegalEffect {
  readonly georgian: string;
  readonly english: string;
}

export interface WaybillConfirmationArgs {
  readonly waybill_id: number;
  readonly confirmation_token?: string;
}

export const waybillIdConfirmationField = waybillIdSchema.describe(
  'RS.ge ზედნადების რიცხვითი ID (მაგ., 1551). ' +
    'RS.ge numeric Waybill ID (e.g. 1551).',
);

export const confirmationTokenField = z
  .string()
  .trim()
  .min(
    1,
    'დადასტურების ტოკენი (confirmation_token) არ შეიძლება იყოს ცარიელი; წინასწარი ნახვისთვის საერთოდ არ მიუთითოთ. ' +
      'confirmation_token cannot be empty; omit it to request a confirmation preview.',
  )
  .optional()
  .describe(
    'ერთჯერადი დადასტურების ტოკენი (მოქმედებს 5 წუთი), მიღებული ამავე ინსტრუმენტის წინასწარი გამოძახებით. ' +
      'პირველ ეტაპზე არ მიუთითოთ — სერვერი დააბრუნებს მოქმედების შეჯამებას და ტოკენს RS.ge ცვლილების გარეშე. ' +
      'Single-use confirmation token (5-minute TTL) obtained by calling this tool without a token first. ' +
      'Omit on the first call to receive a preview summary and token without mutating RS.ge.',
  );

export const waybillConfirmationInputSchema = z.object({
  waybill_id: waybillIdConfirmationField,
  confirmation_token: confirmationTokenField,
});

export interface WaybillPreviewSummary {
  readonly id: number;
  readonly waybillNumber: string | null;
  readonly type: number;
  readonly typeName?: string;
  readonly status: number;
  readonly statusGeorgian: string;
  readonly statusEnglish: string;
  readonly sellerTin?: string;
  readonly sellerName?: string;
  readonly buyerTin?: string;
  readonly buyerName?: string;
  readonly fullAmount: number;
  readonly fullAmountFormatted: string;
  readonly lineItemCount: number;
  readonly beginDate?: string;
  readonly activateDate?: string;
  readonly closeDate?: string;
  readonly confirmationStatus?: Waybill['confirmationStatus'];
}

export interface WaybillConfirmationPreviewResponse {
  readonly requiresConfirmation: true;
  readonly executed: false;
  readonly action: string;
  readonly confirmation_token: string;
  readonly expiresAt: string;
  readonly expiresInSeconds: number;
  readonly waybill: WaybillPreviewSummary;
  readonly legalEffect: BilingualLegalEffect;
  readonly summary: string;
}

export interface WaybillConfirmedActionOptions<
  TArgs extends WaybillConfirmationArgs,
  TResult extends Record<string, unknown>,
> {
  readonly toolName: string;
  readonly args: TArgs;
  readonly legalEffect: BilingualLegalEffect;
  readonly execute: (args: TArgs) => Promise<TResult | ToolResult>;
}

function formatGelAmount(amount: number): string {
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
}

function buildWaybillPreviewSnapshot(waybill: Waybill): WaybillPreviewSummary {
  return {
    id: waybill.id,
    waybillNumber: waybill.waybillNumber.length > 0 ? waybill.waybillNumber : null,
    type: waybill.type,
    ...(waybill.typeName !== undefined ? { typeName: waybill.typeName } : {}),
    status: waybill.status,
    statusGeorgian: waybill.statusGeorgian,
    statusEnglish: waybill.statusEnglish,
    ...(waybill.sellerTin !== undefined ? { sellerTin: waybill.sellerTin } : {}),
    ...(waybill.sellerName !== undefined ? { sellerName: waybill.sellerName } : {}),
    ...(waybill.buyerTin !== undefined ? { buyerTin: waybill.buyerTin } : {}),
    ...(waybill.buyerName !== undefined ? { buyerName: waybill.buyerName } : {}),
    fullAmount: waybill.fullAmount,
    fullAmountFormatted: formatGelAmount(waybill.fullAmount),
    lineItemCount: waybill.lineItems.length,
    ...(waybill.beginDate !== undefined ? { beginDate: waybill.beginDate } : {}),
    ...(waybill.activateDate !== undefined
      ? { activateDate: waybill.activateDate }
      : {}),
    ...(waybill.closeDate !== undefined ? { closeDate: waybill.closeDate } : {}),
    ...(waybill.confirmationStatus !== undefined
      ? { confirmationStatus: waybill.confirmationStatus }
      : {}),
  };
}

function buildPreviewSummaryText(
  toolName: string,
  snapshot: WaybillPreviewSummary,
  legalEffect: BilingualLegalEffect,
  expiresInSeconds: number,
): string {
  const numberKa = snapshot.waybillNumber
    ? `№${snapshot.waybillNumber} (ID: ${snapshot.id})`
    : `ID: ${snapshot.id}`;
  const numberEn = snapshot.waybillNumber
    ? `#${snapshot.waybillNumber} (ID: ${snapshot.id})`
    : `ID: ${snapshot.id}`;

  const buyerKa = snapshot.buyerTin
    ? `${snapshot.buyerTin}${snapshot.buyerName ? ` (${snapshot.buyerName})` : ''}`
    : 'არ არის მითითებული';
  const buyerEn = snapshot.buyerTin
    ? `${snapshot.buyerTin}${snapshot.buyerName ? ` (${snapshot.buyerName})` : ''}`
    : 'N/A';

  const sellerKa = snapshot.sellerTin
    ? ` გამყიდველის TIN: ${snapshot.sellerTin}${snapshot.sellerName ? ` (${snapshot.sellerName})` : ''}.`
    : '';
  const sellerEn = snapshot.sellerTin
    ? ` Seller TIN: ${snapshot.sellerTin}${snapshot.sellerName ? ` (${snapshot.sellerName})` : ''}.`
    : '';

  const ttlMinutes = Math.round(expiresInSeconds / 60);

  const georgian =
    `დადასტურება საჭიროა (${toolName}): ზედნადები ${numberKa}.${sellerKa} ` +
    `მყიდველის TIN: ${buyerKa}. ` +
    `ჯამური თანხა: ${snapshot.fullAmountFormatted} ₾. ` +
    `მიმდინარე ზედნადების სტატუსი: ${snapshot.statusGeorgian} (${snapshot.status}). ` +
    `სამართლებრივი შედეგი: ${legalEffect.georgian} ` +
    `RS.ge-ზე ცვლილება ჯერ არ შესრულებულა — მომხმარებლის დადასტურების შემდეგ გამოიძახეთ ${toolName} ხელახლა მოწოდებული confirmation_token-ით ${ttlMinutes} წუთის განმავლობაში.`;

  const english =
    `Confirmation required (${toolName}): Waybill ${numberEn}.${sellerEn} ` +
    `Buyer TIN: ${buyerEn}. ` +
    `Total amount: ${snapshot.fullAmountFormatted} GEL. ` +
    `Current Waybill Status: ${snapshot.statusEnglish} (${snapshot.status}). ` +
    `Legal/tax effect: ${legalEffect.english} ` +
    `No RS.ge mutation has been executed yet — after user approval, call ${toolName} again with the issued confirmation_token within ${ttlMinutes} minutes.`;

  return `${georgian}\n${english}`;
}

export function formatConfirmationErrorResult(
  failure: Extract<ConsumeConfirmationResult, { readonly ok: false }>,
  toolName: string,
  logger: RsgeLogger,
  extra: Record<string, unknown> = {},
): ToolResult {
  switch (failure.reason) {
    case 'expired':
      return toolErrorResult(
        {
          ...extra,
          executed: false,
          action: toolName,
          error: 'CONFIRMATION_TOKEN_EXPIRED',
          message:
            'დადასტურების ტოკენის ვადა (5 წუთი) ამოიწურა; RS.ge-ზე ცვლილება არ შესრულდა. ' +
            'The confirmation token has expired (5-minute TTL); no RS.ge mutation was executed.',
          hint:
            `გამოიძახეთ ${toolName} confirmation_token-ის გარეშე ახალი შეჯამებისა და ტოკენის მისაღებად. ` +
            `Call ${toolName} without confirmation_token to request a fresh preview and token.`,
        },
        logger,
      );

    case 'already_used':
      return toolErrorResult(
        {
          ...extra,
          executed: false,
          action: toolName,
          error: 'CONFIRMATION_TOKEN_ALREADY_USED',
          message:
            'ეს დადასტურების ტოკენი უკვე გამოყენებულია (ერთჯერადი ტოკენი); RS.ge-ზე ცვლილება არ შესრულდა. ' +
            'This confirmation token has already been used (single-use token); no RS.ge mutation was executed.',
          hint:
            `ახალი მოქმედების დასადასტურებლად გამოიძახეთ ${toolName} confirmation_token-ის გარეშე. ` +
            `Call ${toolName} without confirmation_token to generate a new confirmation token.`,
        },
        logger,
      );

    case 'tool_mismatch':
      return toolErrorResult(
        {
          ...extra,
          executed: false,
          action: toolName,
          error: 'CONFIRMATION_TOKEN_TOOL_MISMATCH',
          message:
            `დადასტურების ტოკენი გაცემულია სხვა ინსტრუმენტისთვის და არ შეესაბამება ${toolName}-ს; RS.ge-ზე ცვლილება არ შესრულდა. ` +
            `The confirmation token was issued for a different tool and does not match ${toolName}; no RS.ge mutation was executed.`,
          hint:
            `გამოიძახეთ ${toolName} confirmation_token-ის გარეშე, რათა მიიღოთ ზუსტად ამ მოქმედებისთვის მიბმული ტოკენი. ` +
            `Call ${toolName} without confirmation_token to obtain a token bound specifically to this tool.`,
        },
        logger,
      );

    case 'args_mismatch':
      return toolErrorResult(
        {
          ...extra,
          executed: false,
          action: toolName,
          error: 'CONFIRMATION_TOKEN_ARGS_MISMATCH',
          message:
            'გადაცემული პარამეტრები არ ემთხვევა იმ პარამეტრებს, რომლებზეც დადასტურების ტოკენი გაიცა; RS.ge-ზე ცვლილება არ შესრულდა. ' +
            'The provided arguments do not match the arguments bound to this confirmation token; no RS.ge mutation was executed.',
          hint:
            `შეცვლილი პარამეტრებით მოქმედებისთვის გამოიძახეთ ${toolName} confirmation_token-ის გარეშე ახალი წინასწარი შეჯამების მისაღებად. ` +
            `For modified arguments, call ${toolName} without confirmation_token to review a new preview and obtain a matching token.`,
        },
        logger,
      );

    case 'invalid':
    default:
      return toolErrorResult(
        {
          ...extra,
          executed: false,
          action: toolName,
          error: 'CONFIRMATION_TOKEN_INVALID',
          message:
            'დადასტურების ტოკენი არასწორია ან უცნობია; RS.ge-ზე ცვლილება არ შესრულდა. ' +
            'The confirmation token is invalid or unrecognized; no RS.ge mutation was executed.',
          hint:
            `გამოიძახეთ ${toolName} confirmation_token-ის გარეშე წინასწარი შეჯამებისა და ვალიდური ტოკენის მისაღებად. ` +
            `Call ${toolName} without confirmation_token to receive a preview summary and a valid token.`,
        },
        logger,
      );
  }
}

export async function executeWaybillConfirmedAction<
  TArgs extends WaybillConfirmationArgs,
  TResult extends Record<string, unknown>,
>(
  context: ServerContext,
  options: WaybillConfirmedActionOptions<TArgs, TResult>,
): Promise<WaybillConfirmationPreviewResponse | TResult | ToolResult> {
  const { toolName, args, legalEffect, execute } = options;
  const extra = { waybillId: args.waybill_id, action: toolName };

  // Step 1: Preview mode (no confirmation_token supplied)
  if (args.confirmation_token === undefined) {
    try {
      const waybill = await fetchWaybillById(
        context.soapClient,
        args.waybill_id,
      );

      if (waybill === null) {
        return toolErrorResult(
          {
            ...extra,
            found: false,
            executed: false,
            error: 'WAYBILL_NOT_FOUND',
            message:
              `ზედნადები ID=${args.waybill_id} RS.ge სისტემაში ვერ მოიძებნა; დადასტურების ტოკენი არ გაიცა. ` +
              `Waybill ID=${args.waybill_id} was not found in RS.ge; no confirmation token was issued.`,
            hint:
              'გადაამოწმეთ ზედნადების ID (get_waybill ან list_waybills) და დარწმუნდით, რომ იგი ეკუთვნის თქვენს გადასახადის გადამხდელს. ' +
              'Verify the Waybill ID (via get_waybill or list_waybills) and confirm it belongs to your Taxpayer profile.',
          },
          context.logger,
        );
      }

      const issued = context.confirmationStore.issue(
        toolName,
        args as unknown as Record<string, unknown>,
      );
      const expiresInSeconds = Math.round(issued.ttlMs / 1000);
      const snapshot = buildWaybillPreviewSnapshot(waybill);
      const summary = buildPreviewSummaryText(
        toolName,
        snapshot,
        legalEffect,
        expiresInSeconds,
      );

      context.logger.info('Issued two-step confirmation preview', {
        toolName,
        waybillId: args.waybill_id,
        status: waybill.status,
        expiresInSeconds,
      });

      return {
        requiresConfirmation: true,
        executed: false,
        action: toolName,
        confirmation_token: issued.token,
        expiresAt: new Date(issued.expiresAt).toISOString(),
        expiresInSeconds,
        waybill: snapshot,
        legalEffect,
        summary,
      };
    } catch (error) {
      return formatSoapErrorResult(error, context.logger, {
        ...extra,
        executed: false,
      });
    }
  }

  // Step 2: Confirmed execution (verify & atomically consume token BEFORE invoking RS.ge)
  const check = context.confirmationStore.consume(
    args.confirmation_token,
    toolName,
    args as unknown as Record<string, unknown>,
  );

  if (!check.ok) {
    context.logger.warn('Rejected confirmation token', {
      toolName,
      waybillId: args.waybill_id,
      reason: check.reason,
    });
    return formatConfirmationErrorResult(
      check,
      toolName,
      context.logger,
      extra,
    );
  }

  try {
    return await execute(args);
  } catch (error) {
    return formatSoapErrorResult(error, context.logger, {
      ...extra,
      executed: false,
    });
  }
}
