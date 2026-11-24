import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import {
  executeWaybillConfirmedAction,
  waybillConfirmationInputSchema,
  type BilingualLegalEffect,
} from '../confirmation/index.js';
import type { ServerContext } from '../context.js';
import { createBooleanResultResponseSchema } from '../soap/xml.js';
import { getWaybillConfirmationInfo } from '../waybill/index.js';
import { toolErrorResult } from './errors.js';

interface BuyerDecisionConfig {
  readonly toolName: 'confirm_waybill' | 'reject_waybill';
  readonly soapOperation: 'confirm_waybill' | 'reject_waybill';
  readonly title: string;
  readonly description: string;
  readonly legalEffect: BilingualLegalEffect;
  readonly resultingConfirmationCode: 1 | -1;
  readonly resultFlagKey: 'confirmed' | 'rejected';
  readonly successVerbKa: string;
  readonly successVerbEn: string;
  readonly failVerbKa: string;
  readonly failVerbEn: string;
}

const BUYER_DECISIONS: readonly BuyerDecisionConfig[] = [
  {
    toolName: 'confirm_waybill',
    soapOperation: 'confirm_waybill',
    title: 'შემომავალი ზედნადების დადასტურება / Confirm Incoming Waybill',
    description:
      'ადასტურებს მყიდველის სახელით მიღებულ შემომავალ ზედნადებს RS.ge-ზე (confirm_waybill) და ოფიციალურად აფიქსირებს საქონლის მიღებაზე თანხმობას. ' +
      'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით ასრულებს დადასტურებას. ' +
      'Confirms an incoming Waybill on behalf of the Buyer in RS.ge (confirm_waybill), formally recording acceptance of the delivered goods. ' +
      'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
    legalEffect: {
      georgian:
        'მყიდველი ოფიციალურად დაადასტურებს შემომავალ ზედნადებს RS.ge-ში (დადასტურების სტატუსი: დადასტურებული / 1), რაც სამართლებრივად და საგადასახადო მიზნებისთვის აფიქსირებს საქონლის მიღებას.',
      english:
        'The Buyer will formally confirm the incoming Waybill in RS.ge (confirmation status: Confirmed / 1), legally recording acceptance of the goods for tax and accounting purposes.',
    },
    resultingConfirmationCode: 1,
    resultFlagKey: 'confirmed',
    successVerbKa: 'დადასტურდა',
    successVerbEn: 'confirmed',
    failVerbKa: 'დადასტურება',
    failVerbEn: 'confirm',
  },
  {
    toolName: 'reject_waybill',
    soapOperation: 'reject_waybill',
    title: 'შემომავალი ზედნადების უარყოფა / Reject Incoming Waybill',
    description:
      'უარყოფს მყიდველის სახელით მიღებულ შემომავალ ზედნადებს RS.ge-ზე (reject_waybill) და აფიქსირებს საქონლის მიღებაზე უარს. ' +
      'დაცულია ორეტაპიანი დადასტურებით: პირველი გამოძახება confirmation_token-ის გარეშე აბრუნებს შეჯამებას და ერთჯერად ტოკენს (5 წუთი); მეორე გამოძახება ტოკენით ასრულებს უარყოფას. ' +
      'Rejects an incoming Waybill on behalf of the Buyer in RS.ge (reject_waybill), formally declining acceptance of the Waybill. ' +
      'Protected by two-step confirmation: call without confirmation_token first to preview and receive a single-use 5-minute token, then call again with the token to execute.',
    legalEffect: {
      georgian:
        'მყიდველი ოფიციალურად უარყოფს შემომავალ ზედნადებს RS.ge-ში (დადასტურების სტატუსი: უარყოფილი / -1), რაც სამართლებრივად აფიქსირებს უარს საქონლის მიღებაზე და ეცნობება გამყიდველს.',
      english:
        'The Buyer will formally reject the incoming Waybill in RS.ge (confirmation status: Rejected / -1), legally recording refusal of the Waybill for the Seller and tax records.',
    },
    resultingConfirmationCode: -1,
    resultFlagKey: 'rejected',
    successVerbKa: 'უარყოფილია',
    successVerbEn: 'rejected',
    failVerbKa: 'უარყოფა',
    failVerbEn: 'reject',
  },
];

export function registerBuyerActionTools(
  server: FastMCP,
  context: ServerContext,
): void {
  for (const config of BUYER_DECISIONS) {
    const responseSchema = createBooleanResultResponseSchema(config.soapOperation);

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
            const succeeded = await context.soapClient.callOperation(
              config.soapOperation,
              { waybill_id },
              responseSchema,
            );

            if (!succeeded) {
              return toolErrorResult(
                {
                  executed: false,
                  action: config.toolName,
                  operation: config.soapOperation,
                  waybillId: waybill_id,
                  [config.resultFlagKey]: false,
                  error: 'RSGE_MUTATION_FAILED',
                  message:
                    `RS.ge-მ ზედნადების (ID=${waybill_id}) ${config.failVerbKa} არ შეასრულა (დაბრუნდა false). ` +
                    `RS.ge did not ${config.failVerbEn} Waybill ID=${waybill_id} (returned false).`,
                  hint:
                    'შეამოწმეთ ზედნადების სტატუსი და მყიდველის საიდენტიფიკაციო კოდი (TIN) get_waybill ინსტრუმენტით, ასევე სერვისის მომხმარებლის ავტორიზაცია check_connection-ით. ' +
                    'Check the Waybill Status and Buyer TIN via get_waybill, and verify Service User credentials and IP allowlisting via check_connection.',
                },
                context.logger,
              );
            }

            const confirmationInfo = getWaybillConfirmationInfo(
              config.resultingConfirmationCode,
            );
            context.logger.info(`Executed RS.ge ${config.soapOperation}`, {
              toolName: config.toolName,
              waybillId: waybill_id,
              confirmationStatus: confirmationInfo.code,
            });

            return {
              executed: true,
              action: config.toolName,
              operation: config.soapOperation,
              waybillId: waybill_id,
              [config.resultFlagKey]: true,
              confirmationStatus: confirmationInfo.code,
              confirmationStatusGeorgian: confirmationInfo.georgian,
              confirmationStatusEnglish: confirmationInfo.english,
              message:
                `შემომავალი ზედნადები ID=${waybill_id} წარმატებით ${config.successVerbKa} (დადასტურების სტატუსი: ${confirmationInfo.georgian}). ` +
                `Incoming Waybill ID=${waybill_id} was ${config.successVerbEn} successfully (confirmation status: ${confirmationInfo.english}).`,
            };
          },
        }),
    );
  }
}
