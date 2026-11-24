import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import type { ServerContext } from '../context.js';
import {
  REFERENCE_RESOURCE_URIS,
  type ReferenceCategory,
} from '../reference/index.js';

interface ReferenceResourceDefinition {
  readonly category: ReferenceCategory;
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
}

const REFERENCE_RESOURCES: readonly ReferenceResourceDefinition[] = [
  {
    category: 'waybill_types',
    uri: REFERENCE_RESOURCE_URIS.waybill_types,
    name: 'waybill-types',
    title: 'ზედნადების ტიპები / Waybill Types',
    description:
      'ზედნადების ტიპების (Waybill Type) საცნობარო მონაცემები RS.ge-დან სესიის ქეშით (get_waybill_types). ' +
      'Session-cached RS.ge Waybill Types Reference Data (get_waybill_types).',
  },
  {
    category: 'units',
    uri: REFERENCE_RESOURCE_URIS.units,
    name: 'units',
    title: 'ზომის ერთეულები / Measurement Units',
    description:
      'ზომის ერთეულების საცნობარო მონაცემები საქონლის პოზიციებისთვის (Line Item) RS.ge-დან სესიის ქეშით (get_waybill_units). ' +
      'Session-cached RS.ge measurement units Reference Data (get_waybill_units).',
  },
  {
    category: 'transport_types',
    uri: REFERENCE_RESOURCE_URIS.transport_types,
    name: 'transport-types',
    title: 'ტრანსპორტირების ტიპები / Transport Types',
    description:
      'ტრანსპორტირების ტიპების (Transport Type) საცნობარო მონაცემები RS.ge-დან სესიის ქეშით (get_trans_types). ' +
      'Session-cached RS.ge Transport Types Reference Data (get_trans_types).',
  },
  {
    category: 'error_codes',
    uri: REFERENCE_RESOURCE_URIS.error_codes,
    name: 'error-codes',
    title: 'RS.ge შეცდომის კოდები / RS.ge Error Codes',
    description:
      'შეცდომის კოდების საცნობარო მონაცემები RS.ge-დან სესიის ქეშით (get_error_codes). ' +
      'Session-cached RS.ge error codes Reference Data (get_error_codes).',
  },
];

export function registerReferenceResources(
  server: FastMCP,
  context: ServerContext,
): void {
  for (const def of REFERENCE_RESOURCES) {
    server.resource(
      {
        uri: def.uri,
        name: def.name,
        title: def.title,
        description: def.description,
        mimeType: 'application/json',
      },
      async () => {
        try {
          return await context.referenceData.getCategory(def.category);
        } catch (error) {
          const rawMessage =
            error instanceof Error ? error.message : String(error);
          throw new Error(context.logger.redact(rawMessage));
        }
      },
    );
  }
}
