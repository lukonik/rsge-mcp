import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import {
  IP_ALLOWLIST_AND_CREDS_HINT,
  formatSoapErrorResult,
} from './errors.js';

export function registerCheckConnectionTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'check_connection',
      title: 'RS.ge კავშირის შემოწმება / Check RS.ge Connection',
      description:
        'ამოწმებს RS.ge სერვისის მომხმარებლის (Service User) მონაცემებსა და გამავალი IP მისამართის დაშვებას RS.ge-ზე (chek_service_user). ' +
        'Verifies RS.ge Service User credentials and outbound IP allowlisting against WayBillService (chek_service_user).',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      input: z.object({}),
    },
    async () => {
      try {
        const result = await context.soapClient.checkServiceUser();

        if (!result.valid) {
          context.logger.warn('RS.ge Service User authentication failed', {
            unId: result.unId,
            serviceUserId: result.serviceUserId,
            endpoint: context.config.endpoint,
          });

          return {
            connected: false,
            unId: result.unId,
            serviceUserId: result.serviceUserId,
            endpoint: context.config.endpoint,
            message:
              'RS.ge სერვისის მომხმარებლის ავტორიზაცია ვერ დადასტურდა. ' +
              'RS.ge Service User authentication failed.',
            hint: IP_ALLOWLIST_AND_CREDS_HINT,
          };
        }

        context.logger.info('RS.ge Service User connection verified', {
          unId: result.unId,
          serviceUserId: result.serviceUserId,
        });

        return {
          connected: true,
          unId: result.unId,
          serviceUserId: result.serviceUserId,
          endpoint: context.config.endpoint,
          message:
            'RS.ge სერვისის მომხმარებლის კავშირი წარმატებით დადასტურდა. ' +
            'RS.ge Service User connection verified successfully.',
        };
      } catch (error) {
        return formatSoapErrorResult(error, context.logger, {
          connected: false,
          endpoint: context.config.endpoint,
        });
      }
    },
  );
}
