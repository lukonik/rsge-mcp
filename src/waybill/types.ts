export type WaybillDirection = 'outgoing' | 'incoming';

export interface WaybillStatusInfo {
  readonly code: number;
  readonly georgian: string;
  readonly english: string;
}

export interface WaybillConfirmationInfo {
  readonly code: number;
  readonly georgian: string;
  readonly english: string;
}

export interface WaybillLineItem {
  readonly id: number;
  readonly name: string;
  readonly unitId: number;
  readonly unitText?: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly status?: number;
  readonly barCode?: string;
  readonly exciseId?: number;
  readonly vatType: number;
  readonly vatTypeLabel?: string;
}

export interface WaybillSummary {
  readonly id: number;
  readonly waybillNumber: string;
  readonly type: number;
  readonly typeName?: string;
  readonly status: number;
  readonly statusGeorgian: string;
  readonly statusEnglish: string;
  readonly sellerTin?: string;
  readonly sellerName?: string;
  readonly sellerUnId?: number;
  readonly buyerTin?: string;
  readonly buyerName?: string;
  readonly fullAmount: number;
  readonly transportCost?: number;
  readonly carNumber?: string;
  readonly driverTin?: string;
  readonly driverName?: string;
  readonly startAddress?: string;
  readonly endAddress?: string;
  readonly createDate?: string;
  readonly beginDate?: string;
  readonly activateDate?: string;
  readonly deliveryDate?: string;
  readonly closeDate?: string;
  readonly confirmationStatus?: WaybillConfirmationInfo;
  readonly confirmationDate?: string;
  readonly comment?: string;
  readonly serviceUserId?: number;
}

export interface Waybill extends WaybillSummary {
  readonly parentId?: number;
  readonly checkBuyerTin?: boolean;
  readonly checkDriverTin?: boolean;
  readonly transportTypeId?: number;
  readonly transportTypeName?: string;
  readonly transportText?: string;
  readonly transportCostPayer?: number;
  readonly receptionInfo?: string;
  readonly receiverInfo?: string;
  readonly category?: number;
  readonly isMedicine?: boolean;
  readonly customStatus?: number;
  readonly customName?: string;
  readonly lineItems: readonly WaybillLineItem[];
}

export interface ListWaybillsFilters {
  readonly direction: WaybillDirection;
  readonly waybillTypes?: readonly number[];
  readonly statuses?: readonly number[];
  readonly counterpartyTin?: string;
  readonly waybillNumber?: string;
  readonly carNumber?: string;
  readonly driverTin?: string;
  readonly fullAmount?: number;
  readonly comment?: string;
  readonly createDateFrom?: string;
  readonly createDateTo?: string;
  readonly beginDateFrom?: string;
  readonly beginDateTo?: string;
  readonly deliveryDateFrom?: string;
  readonly deliveryDateTo?: string;
  readonly closeDateFrom?: string;
  readonly closeDateTo?: string;
}

export interface ListWaybillsResult {
  readonly direction: WaybillDirection;
  readonly operation: 'get_waybills' | 'get_buyer_waybills';
  readonly count: number;
  readonly items: readonly WaybillSummary[];
}

export const WAYBILL_STATUS_LABELS: Readonly<
  Record<number, { readonly georgian: string; readonly english: string }>
> = {
  0: { georgian: 'შენახული', english: 'Draft' },
  1: { georgian: 'გააქტიურებული', english: 'Active' },
  2: { georgian: 'დასრულებული', english: 'Completed' },
  8: { georgian: 'გადამზიდავთან გადაგზავნილი', english: 'Sent to Transporter' },
  [-1]: { georgian: 'წაშლილი', english: 'Deleted' },
  [-2]: { georgian: 'გაუქმებული', english: 'Cancelled' },
};

export const WAYBILL_CONFIRMATION_LABELS: Readonly<
  Record<number, { readonly georgian: string; readonly english: string }>
> = {
  0: { georgian: 'დაუდასტურებელი', english: 'Pending' },
  1: { georgian: 'დადასტურებული', english: 'Confirmed' },
  [-1]: { georgian: 'უარყოფილი', english: 'Rejected' },
};

export const VAT_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: 'ჩვეულებრივი (18%) / Standard VAT (18%)',
  1: 'ნულოვანი (0%) / Zero-rated (0%)',
  2: 'დაუბეგრავი / VAT-exempt',
};

export function getWaybillStatusInfo(code: number): WaybillStatusInfo {
  const known = WAYBILL_STATUS_LABELS[code];
  if (known) {
    return { code, georgian: known.georgian, english: known.english };
  }
  return {
    code,
    georgian: `უცნობი სტატუსი (${code})`,
    english: `Unknown (${code})`,
  };
}

export function getWaybillConfirmationInfo(
  code: number,
): WaybillConfirmationInfo {
  const known = WAYBILL_CONFIRMATION_LABELS[code];
  if (known) {
    return { code, georgian: known.georgian, english: known.english };
  }
  return {
    code,
    georgian: `უცნობი (${code})`,
    english: `Unknown (${code})`,
  };
}
