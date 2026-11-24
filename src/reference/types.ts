export type ReferenceCategory =
  | 'waybill_types'
  | 'units'
  | 'transport_types'
  | 'error_codes';

export const REFERENCE_RESOURCE_URIS: Readonly<Record<ReferenceCategory, string>> = {
  waybill_types: 'rsge://reference/waybill-types',
  units: 'rsge://reference/units',
  transport_types: 'rsge://reference/transport-types',
  error_codes: 'rsge://reference/error-codes',
};

export interface WaybillTypeItem {
  readonly id: number;
  readonly name: string;
  readonly englishName?: string;
}

export interface WaybillUnitItem {
  readonly id: number;
  readonly name: string;
}

export interface TransportTypeItem {
  readonly id: number;
  readonly name: string;
  readonly englishName?: string;
}

export interface RsgeErrorCodeItem {
  readonly code: number;
  readonly text: string;
  readonly type: number;
  readonly englishText?: string;
}

export type ReferenceItemByCategory = {
  readonly waybill_types: WaybillTypeItem;
  readonly units: WaybillUnitItem;
  readonly transport_types: TransportTypeItem;
  readonly error_codes: RsgeErrorCodeItem;
};

export interface ReferenceDataPayload<C extends ReferenceCategory = ReferenceCategory> {
  readonly category: C;
  readonly resourceUri: string;
  readonly count: number;
  readonly items: readonly ReferenceItemByCategory[C][];
}

export const WAYBILL_TYPE_ENGLISH_NAMES: Readonly<Record<number, string>> = {
  1: 'Internal Transfer',
  2: 'Delivery with Transportation',
  3: 'Delivery without Transportation',
  4: 'Distribution',
  5: 'Return',
  6: 'Sub-waybill',
};

export const TRANSPORT_TYPE_ENGLISH_NAMES: Readonly<Record<number, string>> = {
  1: 'Road / Automobile',
  2: 'Railway',
  3: 'Aviation / Air',
  4: 'Other',
  6: 'Foreign Automobile',
  7: 'Carrier / Transporter',
  8: 'Moped / Motorcycle',
};
