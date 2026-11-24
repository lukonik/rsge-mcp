import type { RsgeLogger } from '../logger.js';
import type { RsgeSoapClient } from '../soap/index.js';
import {
  REFERENCE_RESOURCE_URIS,
  type ReferenceCategory,
  type ReferenceDataPayload,
  type ReferenceItemByCategory,
  type RsgeErrorCodeItem,
  type TransportTypeItem,
  type WaybillTypeItem,
  type WaybillUnitItem,
} from './types.js';

export interface CreateReferenceDataStoreOptions {
  readonly soapClient: RsgeSoapClient;
  readonly logger: RsgeLogger;
}

export interface ReferenceDataStore {
  getWaybillTypes(): Promise<readonly WaybillTypeItem[]>;
  getUnits(): Promise<readonly WaybillUnitItem[]>;
  getTransportTypes(): Promise<readonly TransportTypeItem[]>;
  getErrorCodes(): Promise<readonly RsgeErrorCodeItem[]>;
  getCategory<C extends ReferenceCategory>(
    category: C,
  ): Promise<ReferenceDataPayload<C>>;
}

export function createReferenceDataStore(
  options: CreateReferenceDataStoreOptions,
): ReferenceDataStore {
  const { soapClient, logger } = options;
  const cache = new Map<
    ReferenceCategory,
    Promise<readonly ReferenceItemByCategory[ReferenceCategory][]>
  >();

  function getOrFetch<C extends ReferenceCategory>(
    category: C,
    fetcher: () => Promise<ReferenceItemByCategory[C][]>,
  ): Promise<readonly ReferenceItemByCategory[C][]> {
    const existing = cache.get(category) as
      | Promise<readonly ReferenceItemByCategory[C][]>
      | undefined;
    if (existing !== undefined) {
      logger.debug('Serving Reference Data from session cache', { category });
      return existing;
    }

    logger.debug('Fetching Reference Data from RS.ge', { category });
    const pending = fetcher()
      .then((items) => Object.freeze([...items]))
      .catch((error: unknown) => {
        cache.delete(category);
        throw error;
      });

    cache.set(category, pending);
    return pending;
  }

  function getWaybillTypes(): Promise<readonly WaybillTypeItem[]> {
    return getOrFetch('waybill_types', () => soapClient.getWaybillTypes());
  }

  function getUnits(): Promise<readonly WaybillUnitItem[]> {
    return getOrFetch('units', () => soapClient.getWaybillUnits());
  }

  function getTransportTypes(): Promise<readonly TransportTypeItem[]> {
    return getOrFetch('transport_types', () => soapClient.getTransportTypes());
  }

  function getErrorCodes(): Promise<readonly RsgeErrorCodeItem[]> {
    return getOrFetch('error_codes', () => soapClient.getErrorCodes());
  }

  async function getCategory<C extends ReferenceCategory>(
    category: C,
  ): Promise<ReferenceDataPayload<C>> {
    let items: readonly ReferenceItemByCategory[C][];
    switch (category) {
      case 'waybill_types':
        items = (await getWaybillTypes()) as readonly ReferenceItemByCategory[C][];
        break;
      case 'units':
        items = (await getUnits()) as readonly ReferenceItemByCategory[C][];
        break;
      case 'transport_types':
        items = (await getTransportTypes()) as readonly ReferenceItemByCategory[C][];
        break;
      case 'error_codes':
        items = (await getErrorCodes()) as readonly ReferenceItemByCategory[C][];
        break;
    }

    return {
      category,
      resourceUri: REFERENCE_RESOURCE_URIS[category],
      count: items.length,
      items,
    };
  }

  return {
    getWaybillTypes,
    getUnits,
    getTransportTypes,
    getErrorCodes,
    getCategory,
  };
}
