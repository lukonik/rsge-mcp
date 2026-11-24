import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { waybillIdSchema } from '../validation/common.js';
import { fetchWaybillById, fetchWaybillByNumber } from '../waybill/index.js';
import { formatSoapErrorResult, toolErrorResult } from './errors.js';

const getWaybillInputSchema = z
  .object({
    waybill_id: waybillIdSchema
      .optional()
      .describe(
        'RS.ge ზედნადების რიცხვითი ID (მაგ., 1551). არ მიუთითოთ waybill_number-თან ერთად. ' +
          'RS.ge numeric Waybill ID (e.g. 1551). Mutually exclusive with waybill_number.',
      ),
    waybill_number: z
      .string()
      .trim()
      .min(
        1,
        'ზედნადების ნომერი (waybill_number) არ შეიძლება იყოს ცარიელი. waybill_number cannot be empty.',
      )
      .optional()
      .describe(
        'RS.ge ზედნადების ნომერი წამყვანი ნულების შენარჩუნებით (მაგ., "0000014722"). არ მიუთითოთ waybill_id-თან ერთად. ' +
          'RS.ge Waybill number preserving leading zeros (e.g. "0000014722"). Mutually exclusive with waybill_id.',
      ),
  })
  .refine(
    (data) =>
      (data.waybill_id !== undefined) !== (data.waybill_number !== undefined),
    {
      message:
        'მიუთითეთ ზუსტად ერთი პარამეტრი: ან waybill_id, ან waybill_number (არა ორივე და არა ცარიელი). ' +
        'Provide exactly one of waybill_id or waybill_number (not both, not neither).',
    },
  );

export function registerGetWaybillTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'get_waybill',
      title: 'ზედნადების დეტალები / Get Waybill',
      description:
        'აბრუნებს ერთი ზედნადების სრულ დეტალებს RS.ge-დან ზედნადების ID-ით (waybill_id) ან ნომრით (waybill_number): ' +
        'ზედნადების სტატუსი, გამყიდველის და მყიდველის საიდენტიფიკაციო კოდები (TIN), ტრანსპორტირების დეტალები, ჯამური თანხა და საქონლის პოზიციები. ' +
        'Fetches full Waybill details from RS.ge by either waybill_id or waybill_number (exactly one required), ' +
        'including Waybill Status, Seller/Buyer TINs, transport details, totals, and Line Items.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      input: getWaybillInputSchema,
    },
    async ({ waybill_id, waybill_number }) => {
      const extra =
        waybill_id !== undefined
          ? { waybillId: waybill_id }
          : { waybillNumber: waybill_number };

      try {
        const waybill =
          waybill_id !== undefined
            ? await fetchWaybillById(context.soapClient, waybill_id)
            : await fetchWaybillByNumber(context.soapClient, waybill_number!);

        if (waybill === null) {
          return toolErrorResult(
            {
              ...extra,
              found: false,
              error: 'WAYBILL_NOT_FOUND',
              message:
                'მითითებული ზედნადები RS.ge სისტემაში ვერ მოიძებნა. ' +
                'The requested Waybill was not found in RS.ge.',
              hint:
                'გადაამოწმეთ ზედნადების ID ან ნომერი და დარწმუნდით, რომ იგი ეკუთვნის თქვენს გადასახადის გადამხდელს. ' +
                'Verify the Waybill ID or Waybill number and ensure it belongs to your Taxpayer profile.',
            },
            context.logger,
          );
        }

        return {
          found: true,
          waybill,
        };
      } catch (error) {
        return formatSoapErrorResult(error, context.logger, extra);
      }
    },
  );
}
