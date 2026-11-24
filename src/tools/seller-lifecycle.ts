import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import {
  executeWaybillConfirmedAction,
  waybillConfirmationInputSchema,
  type BilingualLegalEffect,
} from '../confirmation/index.js';
import type { ServerContext } from '../context.js';
import { xmlIntSchema } from '../soap/xml.js';
import { getWaybillStatusInfo } from '../waybill/index.js';
import { toolErrorResult } from './errors.js';

const sendWaybillResponseSchema = z.object({
  send_waybillResult: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value == null ? '' : String(value).trim())),
});

interface IntStatusMutationConfig {
  readonly toolName: 'close_waybill' | 'delete_waybill_draft' | 'cancel_waybill';
  readonly soapOperation: 'close_waybill' | 'del_waybill' | 'ref_waybill';
  readonly title: string;
  readonly description: string;
  readonly legalEffect: BilingualLegalEffect;
  readonly resultingStatus: 2 | -1 | -2;
  readonly successVerbKa: string;
  readonly successVerbEn: string;
}

const INT_STATUS_MUTATIONS: readonly IntStatusMutationConfig[] = [
  {
    toolName: 'close_waybill',
    soapOperation: 'close_waybill',
    title: 'ზედნადების დასრულება / Close (Complete) Waybill',
    description:
      'ასრულებს გააქტიურებულ (Active) ზედნადებს RS.ge-ზე (close_waybill), გადაჰყავს დასრულებული (Completed) სტატუსში და აფიქსირებს საქონლის მიწოდების/ტრანსპორტირების დასრულებას. ' +
      'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით ასრულებს დახურვას. ' +
      'Completes an Active Waybill in RS.ge (close_waybill), transitioning its Waybill Status to Completed (2) and finalizing delivery/transportation. ' +
      'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
    legalEffect: {
      georgian:
        'გააქტიურებული ზედნადები გადავა დასრულებულ სტატუსში (დასრულებული / 2), დაფიქსირდება მიწოდების დასრულება და ტრანსპორტირების რედაქტირება შეიზღუდება.',
      english:
        'The Active Waybill will transition to Completed status (2), finalizing goods delivery in RS.ge and locking further transportation edits.',
    },
    resultingStatus: 2,
    successVerbKa: 'დასრულდა',
    successVerbEn: 'closed (completed)',
  },
  {
    toolName: 'delete_waybill_draft',
    soapOperation: 'del_waybill',
    title: 'შენახული ზედნადების წაშლა / Delete Draft Waybill',
    description:
      'სამუდამოდ შლის შენახულ (Draft) ზედნადებს RS.ge-ზე (del_waybill). მოქმედება შეუქცევადია და დასაშვებია მხოლოდ შენახული (სტატუსი 0) ზედნადებისთვის. ' +
      'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით შლის ზედნადებს. ' +
      'Permanently deletes an unactivated Draft Waybill in RS.ge (del_waybill). Irreversible action valid only for Draft Waybills (status 0). ' +
      'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
    legalEffect: {
      georgian:
        'შენახული ზედნადები შეუქცევადად წაიშლება RS.ge-დან (სტატუსი: წაშლილი / -1) და მისი აღდგენა შეუძლებელი იქნება.',
      english:
        'The Draft Waybill will be permanently deleted in RS.ge (status: Deleted / -1) and cannot be recovered.',
    },
    resultingStatus: -1,
    successVerbKa: 'წაიშალა',
    successVerbEn: 'deleted',
  },
  {
    toolName: 'cancel_waybill',
    soapOperation: 'ref_waybill',
    title: 'გააქტიურებული ზედნადების გაუქმება / Cancel Active Waybill',
    description:
      'აუქმებს გააქტიურებულ (Active) ზედნადებს RS.ge-ზე (ref_waybill) და გადაჰყავს გაუქმებული (Cancelled) სტატუსში (-2). მოქმედება სამართლებრივად სავალდებულო და შეუქცევადია. ' +
      'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით აუქმებს ზედნადებს. ' +
      'Cancels an Active Waybill in RS.ge (ref_waybill), transitioning its Waybill Status to Cancelled (-2). Legally binding and irreversible action. ' +
      'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
    legalEffect: {
      georgian:
        'გააქტიურებული ზედნადები შეუქცევადად გაუქმდება RS.ge-ში (სტატუსი: გაუქმებული / -2) და მისი ხელახალი გააქტიურება შეუძლებელი იქნება.',
      english:
        'The Active Waybill will be irreversibly cancelled in RS.ge (status: Cancelled / -2) and cannot be reactivated.',
    },
    resultingStatus: -2,
    successVerbKa: 'გაუქმდა',
    successVerbEn: 'cancelled',
  },
];

function createIntResultResponseSchema<TOp extends string>(operation: TOp) {
  const resultKey = `${operation}Result` as const;
  return z
    .object({
      [resultKey]: xmlIntSchema,
    })
    .transform((record) => record[resultKey] as number);
}

export function registerSellerLifecycleTools(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'send_waybill',
      title: 'ზედნადების გააქტიურება / Activate (Send) Waybill',
      description:
        'ააქტიურებს შენახულ (Draft) ზედნადებს RS.ge-ზე (send_waybill), ანიჭებს ოფიციალურ ზედნადების ნომერს და იწყებს სამართლებრივად სავალდებულო ტრანსპორტირებას/მიწოდებას. ' +
        'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით ასრულებს გააქტიურებას. ' +
        'Activates a Draft Waybill in RS.ge (send_waybill), assigning an official Waybill number and registering legally binding goods transport/delivery. ' +
        'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
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
        toolName: 'send_waybill',
        args,
        legalEffect: {
          georgian:
            'შენახული ზედნადები გააქტიურდება (სტატუსი: გააქტიურებული / 1), მიენიჭება ოფიციალური ზედნადების ნომერი და RS.ge-ში დაფიქსირდება სამართლებრივად სავალდებულო ტრანსპორტირება/მიწოდება.',
          english:
            'The Draft Waybill will become Active (status 1), receive an official RS.ge Waybill number, and register legally binding goods transportation/delivery with the Revenue Service of Georgia.',
        },
        execute: async ({ waybill_id }) => {
          const parsed = await context.soapClient.callOperation(
            'send_waybill',
            { waybill_id },
            sendWaybillResponseSchema,
          );
          const waybillNumber = parsed.send_waybillResult;

          if (waybillNumber.length === 0 || waybillNumber === '0') {
            return toolErrorResult(
              {
                executed: false,
                action: 'send_waybill',
                operation: 'send_waybill',
                waybillId: waybill_id,
                error: 'RSGE_MUTATION_FAILED',
                message:
                  `RS.ge-მ ზედნადები ID=${waybill_id} ვერ გაააქტიურა (დაბრუნდა ცარიელი ან ნულოვანი ზედნადების ნომერი). ` +
                  `RS.ge did not activate Waybill ID=${waybill_id} (returned empty or zero Waybill number).`,
                hint:
                  'შეამოწმეთ ზედნადების მიმდინარე სტატუსი და სავალდებულო ველები get_waybill ინსტრუმენტით. ' +
                  'Check the Waybill current Waybill Status and required fields using get_waybill.',
              },
              context.logger,
            );
          }

          const statusInfo = getWaybillStatusInfo(1);
          context.logger.info('Activated RS.ge Waybill via send_waybill', {
            waybillId: waybill_id,
            waybillNumber,
          });

          return {
            executed: true,
            action: 'send_waybill',
            operation: 'send_waybill',
            waybillId: waybill_id,
            waybillNumber,
            status: statusInfo.code,
            statusGeorgian: statusInfo.georgian,
            statusEnglish: statusInfo.english,
            message:
              `ზედნადები ID=${waybill_id} წარმატებით გააქტიურდა (ნომერი: ${waybillNumber}, სტატუსი: ${statusInfo.georgian}). ` +
              `Waybill ID=${waybill_id} was activated successfully (number: ${waybillNumber}, status: ${statusInfo.english}).`,
          };
        },
      }),
  );

  for (const config of INT_STATUS_MUTATIONS) {
    const responseSchema = createIntResultResponseSchema(config.soapOperation);

    server.tool(
      {
        name: config.toolName,
        title: config.title,
        description: config.description,
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
          toolName: config.toolName,
          args,
          legalEffect: config.legalEffect,
          execute: async ({ waybill_id }) => {
            const code = await context.soapClient.callOperation(
              config.soapOperation,
              { waybill_id },
              responseSchema,
            );

            if (code !== 1) {
              return toolErrorResult(
                {
                  executed: false,
                  action: config.toolName,
                  operation: config.soapOperation,
                  waybillId: waybill_id,
                  resultCode: code,
                  error: 'RSGE_MUTATION_FAILED',
                  message:
                    `RS.ge ოპერაცია ${config.soapOperation} არ დასრულდა წარმატებით ზედნადებზე ID=${waybill_id} (პასუხის კოდი: ${code}). ` +
                    `RS.ge operation ${config.soapOperation} did not succeed for Waybill ID=${waybill_id} (result code: ${code}).`,
                  hint:
                    'შეამოწმეთ ზედნადების მიმდინარე სტატუსი get_waybill ინსტრუმენტით. ' +
                    'Check the Waybill current Waybill Status via get_waybill.',
                },
                context.logger,
              );
            }

            const statusInfo = getWaybillStatusInfo(config.resultingStatus);
            context.logger.info(`Executed RS.ge ${config.soapOperation}`, {
              toolName: config.toolName,
              waybillId: waybill_id,
              resultingStatus: statusInfo.code,
            });

            return {
              executed: true,
              action: config.toolName,
              operation: config.soapOperation,
              waybillId: waybill_id,
              status: statusInfo.code,
              statusGeorgian: statusInfo.georgian,
              statusEnglish: statusInfo.english,
              message:
                `ზედნადები ID=${waybill_id} წარმატებით ${config.successVerbKa} (სტატუსი: ${statusInfo.georgian}). ` +
                `Waybill ID=${waybill_id} was ${config.successVerbEn} successfully (status: ${statusInfo.english}).`,
            };
          },
        }),
    );
  }
}
