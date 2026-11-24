import type { RsgeSoapClient, SoapParamValue } from '../soap/index.js';
import { normalizeDateBound } from '../validation/common.js';
import {
  getBuyerWaybillsResponseSchema,
  getWaybillByNumberResponseSchema,
  getWaybillResponseSchema,
  getWaybillsResponseSchema,
} from './parse.js';
import type {
  ListWaybillsFilters,
  ListWaybillsResult,
  Waybill,
} from './types.js';

function formatRsgeCommaList(values: readonly number[] | undefined): string {
  if (!values || values.length === 0) {
    return '';
  }
  return `,${values.join(',')},`;
}

function toNullableRsgeDateTime(
  value: string | undefined,
  bound: 'start' | 'end',
): SoapParamValue {
  if (value === undefined) {
    return { nil: true };
  }
  return normalizeDateBound(value, bound);
}

export async function fetchWaybillById(
  soapClient: RsgeSoapClient,
  waybillId: number,
): Promise<Waybill | null> {
  return soapClient.callOperation(
    'get_waybill',
    { waybill_id: waybillId },
    getWaybillResponseSchema,
  );
}

export async function fetchWaybillByNumber(
  soapClient: RsgeSoapClient,
  waybillNumber: string,
): Promise<Waybill | null> {
  return soapClient.callOperation(
    'get_waybill_by_number',
    { waybill_number: waybillNumber },
    getWaybillByNumberResponseSchema,
  );
}

export async function listWaybills(
  soapClient: RsgeSoapClient,
  filters: ListWaybillsFilters,
): Promise<ListWaybillsResult> {
  const isOutgoing = filters.direction === 'outgoing';
  const operation = isOutgoing ? 'get_waybills' : 'get_buyer_waybills';
  const counterpartyParamKey = isOutgoing ? 'buyer_tin' : 'seller_tin';

  // Exact 19-parameter WSDL sequence (su & sp are prepended by soapClient.callOperation).
  // All nillable dateTime and decimal fields use xsi:nil="true" when unset (never empty tags).
  const params: Record<string, SoapParamValue> = {
    itypes: formatRsgeCommaList(filters.waybillTypes),
    [counterpartyParamKey]: filters.counterpartyTin ?? '',
    statuses: formatRsgeCommaList(filters.statuses),
    car_number: filters.carNumber ?? '',
    begin_date_s: toNullableRsgeDateTime(filters.beginDateFrom, 'start'),
    begin_date_e: toNullableRsgeDateTime(filters.beginDateTo, 'end'),
    create_date_s: toNullableRsgeDateTime(filters.createDateFrom, 'start'),
    create_date_e: toNullableRsgeDateTime(filters.createDateTo, 'end'),
    driver_tin: filters.driverTin ?? '',
    delivery_date_s: toNullableRsgeDateTime(filters.deliveryDateFrom, 'start'),
    delivery_date_e: toNullableRsgeDateTime(filters.deliveryDateTo, 'end'),
    full_amount:
      filters.fullAmount !== undefined ? filters.fullAmount : { nil: true },
    waybill_number: filters.waybillNumber ?? '',
    close_date_s: toNullableRsgeDateTime(filters.closeDateFrom, 'start'),
    close_date_e: toNullableRsgeDateTime(filters.closeDateTo, 'end'),
    s_user_ids: '',
    comment: filters.comment ?? '',
  };

  const items = await soapClient.callOperation(
    operation,
    params,
    isOutgoing ? getWaybillsResponseSchema : getBuyerWaybillsResponseSchema,
  );

  return {
    direction: filters.direction,
    operation,
    count: items.length,
    items,
  };
}
