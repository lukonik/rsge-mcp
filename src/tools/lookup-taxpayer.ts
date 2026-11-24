import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { createBooleanResultResponseSchema } from '../soap/index.js';
import { georgianTinSchema } from '../validation/common.js';
import { formatSoapErrorResult } from './errors.js';

const lookupTaxpayerInputSchema = z.object({
  tin: georgianTinSchema.describe(
    'გადასახადის გადამხდელის საიდენტიფიკაციო კოდი (TIN): 9-ნიშნა იურიდიული პირისთვის ან 11-ნიშნა ფიზიკური პირისთვის. ' +
      'Taxpayer TIN: 9 digits for a legal entity or 11 digits for an individual.',
  ),
});

const getNameFromTinResponseSchema = z
  .union([
    z.literal(''),
    z.object({
      get_name_from_tinResult: z
        .union([z.string(), z.number()])
        .optional()
        .default('')
        .transform((value) => String(value).trim()),
    }),
  ])
  .transform((value) =>
    typeof value === 'string' ? '' : value.get_name_from_tinResult,
  );

const isVatPayerTinResponseSchema =
  createBooleanResultResponseSchema('is_vat_payer_tin');

export function registerLookupTaxpayerTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'lookup_taxpayer',
      title: 'გადასახადის გადამხდელის ძიება / Lookup Taxpayer',
      description:
        'ეძებს გადასახადის გადამხდელს (Taxpayer) 9-ნიშნა (იურიდიული პირი) ან 11-ნიშნა (ფიზიკური პირი) საიდენტიფიკაციო კოდით (TIN) და ერთ მოთხოვნაში აბრუნებს რეგისტრირებულ დასახელებას (get_name_from_tin) და დღგ-ის გადამხდელის სტატუსს (is_vat_payer_tin). ' +
        'Looks up a counterparty Taxpayer by 9-digit (legal entity) or 11-digit (individual) TIN and returns both the registered Taxpayer name (get_name_from_tin) and VAT payer status (is_vat_payer_tin) in a single call.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      input: lookupTaxpayerInputSchema,
    },
    async ({ tin }) => {
      try {
        const [name, isVatPayer] = await Promise.all([
          context.soapClient.callOperation(
            'get_name_from_tin',
            { tin },
            getNameFromTinResponseSchema,
          ),
          context.soapClient.callOperation(
            'is_vat_payer_tin',
            { tin },
            isVatPayerTinResponseSchema,
          ),
        ]);

        const taxpayerType = tin.length === 9 ? 'legal_entity' : 'individual';

        if (name.length === 0) {
          context.logger.info('Taxpayer not found on RS.ge', {
            tin,
            taxpayerType,
          });

          return {
            found: false,
            tin,
            taxpayerType,
            name: null,
            isVatPayer: false,
            message:
              `საიდენტიფიკაციო კოდით (${tin}) გადასახადის გადამხდელი RS.ge-ზე ვერ მოიძებნა. ` +
              `No Taxpayer found on RS.ge for TIN ${tin}.`,
            hint:
              'გადაამოწმეთ საიდენტიფიკაციო კოდი (TIN). თუ TIN სწორია, შეამოწმეთ სერვისის მომხმარებლის ავტორიზაცია და IP დაშვება check_connection ინსტრუმენტით. ' +
              'Verify the TIN. If the TIN is correct, verify Service User credentials and IP allowlisting using check_connection.',
          };
        }

        return {
          found: true,
          tin,
          taxpayerType,
          name,
          isVatPayer,
        };
      } catch (error) {
        return formatSoapErrorResult(error, context.logger, { tin });
      }
    },
  );
}
