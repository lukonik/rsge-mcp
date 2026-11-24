import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { listWaybills } from '../waybill/index.js';
import { formatSoapErrorResult } from './errors.js';

const ISO_DATE_OR_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/;

const TIN_PATTERN = /^\d{9}$|^\d{11}$/;

function isValidIsoDateOrDateTime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

const isoDateOrDateTimeSchema = z
  .string()
  .trim()
  .regex(
    ISO_DATE_OR_DATETIME_PATTERN,
    'თარიღის ფორმატი უნდა იყოს YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss. ' +
      'Date must be formatted as YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.',
  )
  .refine(
    isValidIsoDateOrDateTime,
    'მიუთითეთ ვალიდური კალენდარული თარიღი/დრო (YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss). ' +
      'Provide a valid calendar date/time (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss).',
  );

const tinFilterSchema = z
  .string()
  .trim()
  .regex(
    TIN_PATTERN,
    'საიდენტიფიკაციო კოდი (TIN) უნდა შედგებოდეს 9 (იურიდიული პირი) ან 11 (ფიზიკური პირი) ციფრისგან. ' +
      'TIN must be 9 digits (legal entity) or 11 digits (individual).',
  );

function normalizeDateBound(value: string, bound: 'start' | 'end'): string {
  return value.length === 10
    ? bound === 'start'
      ? `${value}T00:00:00`
      : `${value}T23:59:59`
    : value;
}

const listWaybillsInputSchema = z
  .object({
    direction: z
      .enum(['outgoing', 'incoming'], {
        error:
          'მიმართულება (direction) უნდა იყოს "outgoing" (გამავალი) ან "incoming" (შემომავალი). ' +
          'direction must be "outgoing" or "incoming".',
      })
      .describe(
        'ზედნადებების მიმართულება: "outgoing" (გამავალი — გამყიდველის მიერ გამოწერილი, get_waybills) ' +
          'ან "incoming" (შემომავალი — მყიდველის მიერ მიღებული, get_buyer_waybills). ' +
          'Waybill direction: "outgoing" (Seller waybills via get_waybills) or "incoming" (Buyer waybills via get_buyer_waybills).',
      ),
    waybill_types: z
      .array(z.number().int().positive())
      .min(1)
      .optional()
      .describe(
        'ზედნადების ტიპების ID-ების ფილტრი (მაგ., [2] — ტრანსპორტირებით, [1, 2]). ' +
          'Filter by Waybill Type IDs (e.g. [2] for Delivery with Transportation).',
      ),
    statuses: z
      .array(z.number().int())
      .min(1)
      .optional()
      .describe(
        'ზედნადების სტატუსების ფილტრი: 0=შენახული (Draft), 1=გააქტიურებული (Active), 2=დასრულებული (Completed), ' +
          '8=გადამზიდავთან გადაგზავნილი (Sent to Transporter), -1=წაშლილი (Deleted), -2=გაუქმებული (Cancelled). ' +
          'Filter by Waybill Status codes.',
      ),
    counterparty_tin: tinFilterSchema
      .optional()
      .describe(
        'კონტრაგენტის საიდენტიფიკაციო კოდი (TIN): outgoing-ისთვის მყიდველის TIN (buyer_tin), incoming-ისთვის გამყიდველის TIN (seller_tin). ' +
          'Counterparty TIN: Buyer TIN when direction is "outgoing", Seller TIN when direction is "incoming".',
      ),
    waybill_number: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'ზედნადების ნომრის ფილტრი (წამყვანი ნულებით, მაგ., "0000014722"). ' +
          'Filter by exact Waybill number (preserving leading zeros).',
      ),
    create_date_from: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'შექმნის თარიღი (-დან), ფორმატი YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss. ' +
          'Creation date range start (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss).',
      ),
    create_date_to: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'შექმნის თარიღი (-მდე), ფორმატი YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss. ' +
          'Creation date range end (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss).',
      ),
    begin_date_from: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'ტრანსპორტირების დაწყების თარიღი (-დან). ' +
          'Transportation begin date range start.',
      ),
    begin_date_to: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'ტრანსპორტირების დაწყების თარიღი (-მდე). ' +
          'Transportation begin date range end.',
      ),
    delivery_date_from: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'მიწოდების თარიღი (-დან). Delivery date range start.',
      ),
    delivery_date_to: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'მიწოდების თარიღი (-მდე). Delivery date range end.',
      ),
    close_date_from: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'დასრულების თარიღი (-დან). Completion/close date range start.',
      ),
    close_date_to: isoDateOrDateTimeSchema
      .optional()
      .describe(
        'დასრულების თარიღი (-მდე). Completion/close date range end.',
      ),
    car_number: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'ავტომობილის სახელმწიფო ნომრის ფილტრი (მაგ., "AA123BB"). ' +
          'Filter by vehicle plate number.',
      ),
    driver_tin: tinFilterSchema
      .optional()
      .describe(
        'მძღოლის საიდენტიფიკაციო კოდის (TIN) ფილტრი. Filter by driver TIN.',
      ),
    full_amount: z
      .number()
      .nonnegative()
      .optional()
      .describe(
        'ზედნადების ჯამური თანხის ფილტრი. Filter by exact total Waybill amount.',
      ),
    comment: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('კომენტარის ფილტრი. Filter by Waybill comment.'),
  })
  .superRefine((data, ctx) => {
    const pairs: ReadonlyArray<
      readonly [string, string | undefined, string, string | undefined]
    > = [
      ['create_date_from', data.create_date_from, 'create_date_to', data.create_date_to],
      ['begin_date_from', data.begin_date_from, 'begin_date_to', data.begin_date_to],
      [
        'delivery_date_from',
        data.delivery_date_from,
        'delivery_date_to',
        data.delivery_date_to,
      ],
      ['close_date_from', data.close_date_from, 'close_date_to', data.close_date_to],
    ];

    for (const [fromKey, fromVal, toKey, toVal] of pairs) {
      if (fromVal !== undefined && toVal !== undefined) {
        const normalizedFrom = normalizeDateBound(fromVal, 'start');
        const normalizedTo = normalizeDateBound(toVal, 'end');
        if (normalizedFrom > normalizedTo) {
          ctx.addIssue({
            code: 'custom',
            path: [fromKey],
            message:
              `საწყისი თარიღი (${fromKey}) არ შეიძლება იყოს საბოლოო თარიღზე (${toKey}) გვიან. ` +
              `Start date (${fromKey}) cannot be after end date (${toKey}).`,
          });
        }
      }
    }
  });

export function registerListWaybillsTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'list_waybills',
      title: 'ზედნადებების სია / List Waybills',
      description:
        'აბრუნებს გამავალი (direction="outgoing", გამყიდველის) ან შემომავალი (direction="incoming", მყიდველის) ' +
        'ზედნადებების სიას RS.ge-დან თარიღის, ზედნადების სტატუსის, კონტრაგენტის საიდენტიფიკაციო კოდის (TIN), ' +
        'ზედნადების ტიპის და ნომრის ფილტრებით. ' +
        'Queries outgoing Seller Waybills (get_waybills) or incoming Buyer Waybills (get_buyer_waybills) from RS.ge ' +
        'with optional date range, Waybill Status, counterparty TIN, Waybill Type, and Waybill number filters.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      input: listWaybillsInputSchema,
    },
    async (args) => {
      try {
        return await listWaybills(context.soapClient, {
          direction: args.direction,
          waybillTypes: args.waybill_types,
          statuses: args.statuses,
          counterpartyTin: args.counterparty_tin,
          waybillNumber: args.waybill_number,
          createDateFrom: args.create_date_from,
          createDateTo: args.create_date_to,
          beginDateFrom: args.begin_date_from,
          beginDateTo: args.begin_date_to,
          deliveryDateFrom: args.delivery_date_from,
          deliveryDateTo: args.delivery_date_to,
          closeDateFrom: args.close_date_from,
          closeDateTo: args.close_date_to,
          carNumber: args.car_number,
          driverTin: args.driver_tin,
          fullAmount: args.full_amount,
          comment: args.comment,
        });
      } catch (error) {
        return formatSoapErrorResult(error, context.logger, {
          direction: args.direction,
        });
      }
    },
  );
}
