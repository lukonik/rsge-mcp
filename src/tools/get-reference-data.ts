import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import { formatSoapErrorResult } from './errors.js';

const referenceCategoryInputSchema = z.object({
  category: z
    .enum(['waybill_types', 'units', 'transport_types', 'error_codes'])
    .describe(
      'საცნობარო მონაცემების კატეგორია: waybill_types (ზედნადების ტიპები), units (ზომის ერთეულები), transport_types (ტრანსპორტირების ტიპები), error_codes (RS.ge შეცდომის კოდები). ' +
        'Reference Data category: waybill_types, units, transport_types, or error_codes.',
    ),
});

export function registerGetReferenceDataTool(
  server: FastMCP,
  context: ServerContext,
): void {
  server.tool(
    {
      name: 'get_reference_data',
      title: 'საცნობარო მონაცემების მიღება / Get Reference Data',
      description:
        'აბრუნებს RS.ge საცნობარო მონაცემებს (Reference Data) სესიის საერთო ქეშიდან: ზედნადების ტიპები (waybill_types), ზომის ერთეულები (units), ტრანსპორტირების ტიპები (transport_types) და შეცდომის კოდები (error_codes). ' +
        'Returns session-cached RS.ge Reference Data (waybill_types, units, transport_types, or error_codes) for MCP clients that do not read MCP Resources.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      input: referenceCategoryInputSchema,
    },
    async ({ category }) => {
      try {
        return await context.referenceData.getCategory(category);
      } catch (error) {
        return formatSoapErrorResult(error, context.logger, { category });
      }
    },
  );
}
