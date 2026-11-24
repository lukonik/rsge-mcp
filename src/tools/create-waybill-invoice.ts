import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import {
  executeWaybillConfirmedAction,
  waybillConfirmationInputSchema,
} from '../confirmation/index.js';
import type { ServerContext } from '../context.js';
import { createIntResultResponseSchema, xmlIntSchema } from '../soap/xml.js';
import { toolErrorResult } from './errors.js';

const saveInvoiceResponseSchema = createIntResultResponseSchema('save_invoice', {
  out_inv_id: xmlIntSchema.optional().default(0),
});

export function registerCreateWaybillInvoiceTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'create_waybill_invoice',
      title: 'ზედნადებზე ანგარიშ-ფაქტურის გამოწერა / Create Waybill-Linked Tax Invoice',
      description:
        'ქმნის არსებულ ზედნადებთან დაკავშირებულ საგადასახადო ანგარიშ-ფაქტურას RS.ge-ზე გამყიდველის სახელით (save_invoice) და აბრუნებს შექმნილი ანგარიშ-ფაქტურის ID-ს. ' +
        'მოქმედებას აქვს დღგ-ის საგადასახადო და სამართლებრივი შედეგი და დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით ქმნის ანგარიშ-ფაქტურას. ' +
        'Creates a Waybill-linked Tax Invoice in RS.ge on behalf of the Seller (save_invoice) and returns the created Tax Invoice ID. ' +
        'Carries binding VAT/tax consequences and is protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      input: waybillConfirmationInputSchema,
    },
    async (args) =>
      executeWaybillConfirmedAction(context, {
        toolName: 'create_waybill_invoice',
        args,
        legalEffect: {
          georgian:
            'ამ ზედნადების საფუძველზე RS.ge-ში შეიქმნება ახალი საგადასახადო ანგარიშ-ფაქტურა გამყიდველის სახელით, რაც წარმოშობს ოფიციალურ დღგ-ის საგადასახადო ვალდებულებასა და ჩანაწერს.',
          english:
            'A new Waybill-linked Tax Invoice will be created in RS.ge on behalf of the Seller, creating a legally binding VAT tax document and reporting obligation.',
        },
        execute: async ({ waybill_id }) => {
          // Exact WSDL sequence: su, sp, waybill_id, in_inv_id (0 = create new Tax Invoice)
          const parsed = await context.soapClient.callOperation(
            'save_invoice',
            { waybill_id, in_inv_id: 0 },
            saveInvoiceResponseSchema,
          );

          if (parsed.save_invoiceResult !== 1 || parsed.out_inv_id <= 0) {
            return toolErrorResult(
              {
                executed: false,
                action: 'create_waybill_invoice',
                operation: 'save_invoice',
                waybillId: waybill_id,
                resultCode: parsed.save_invoiceResult,
                invoiceId: parsed.out_inv_id,
                error: 'RSGE_MUTATION_FAILED',
                message:
                  `RS.ge-მ ზედნადებზე ID=${waybill_id} ანგარიშ-ფაქტურა ვერ შექმნა (პასუხის კოდი: ${parsed.save_invoiceResult}, ანგარიშ-ფაქტურის ID: ${parsed.out_inv_id}). ` +
                  `RS.ge did not create a Tax Invoice for Waybill ID=${waybill_id} (result code: ${parsed.save_invoiceResult}, invoice ID: ${parsed.out_inv_id}).`,
                hint:
                  'შეამოწმეთ ზედნადების სტატუსი (get_waybill), გამყიდველის დღგ-ის გადამხდელის სტატუსი (lookup_taxpayer) და დარწმუნდით, რომ ანგარიშ-ფაქტურა ჯერ არ არის გამოწერილი. ' +
                  'Check the Waybill Status (get_waybill), Seller VAT payer registration (lookup_taxpayer), and confirm no Tax Invoice is already linked.',
              },
              context.logger,
            );
          }

          context.logger.info('Created Waybill-linked Tax Invoice via save_invoice', {
            waybillId: waybill_id,
            invoiceId: parsed.out_inv_id,
          });

          return {
            executed: true,
            action: 'create_waybill_invoice',
            operation: 'save_invoice',
            waybillId: waybill_id,
            invoiceId: parsed.out_inv_id,
            message:
              `ზედნადებზე ID=${waybill_id} წარმატებით შეიქმნა ანგარიშ-ფაქტურა ID=${parsed.out_inv_id}. ` +
              `Tax Invoice ID=${parsed.out_inv_id} was created successfully for Waybill ID=${waybill_id}.`,
          };
        },
      }),
  );
}
