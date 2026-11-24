import { soapEnvelope } from './soap.js';

export interface GoodsFixture {
  readonly id: number;
  readonly name: string;
  readonly unitId: number;
  readonly unitText?: string;
  readonly quantity: string | number;
  readonly price: string | number;
  readonly status?: number;
  readonly amount: string | number;
  readonly barCode?: string;
  readonly exciseId?: number;
  readonly vatType: number;
}

export interface WaybillFixture {
  readonly id: number;
  readonly waybillNumber?: string;
  readonly type: number;
  readonly status: number;
  readonly sellerTin?: string;
  readonly sellerName?: string;
  readonly sellerUnId?: number;
  readonly buyerTin?: string;
  readonly buyerName?: string;
  readonly checkBuyerTin?: number;
  readonly startAddress?: string;
  readonly endAddress?: string;
  readonly driverTin?: string;
  readonly driverName?: string;
  readonly checkDriverTin?: number;
  readonly carNumber?: string;
  readonly transportCost?: string | number;
  readonly transportTypeId?: number;
  readonly transportText?: string;
  readonly transportCostPayer?: number;
  readonly fullAmount: string | number;
  readonly createDate?: string;
  readonly beginDate?: string;
  readonly activateDate?: string;
  readonly deliveryDate?: string;
  readonly closeDate?: string;
  readonly isConfirmed?: number;
  readonly confirmationDate?: string;
  readonly receptionInfo?: string;
  readonly receiverInfo?: string;
  readonly comment?: string;
  readonly serviceUserId?: number;
  readonly parentId?: number | '';
  readonly category?: number;
  readonly isMed?: number;
  readonly goods?: readonly GoodsFixture[];
  readonly omitGoodsList?: boolean;
}

function goodsItemXml(item: GoodsFixture): string {
  return (
    `<GOODS>` +
    `<ID>${item.id}</ID>` +
    `<W_NAME>${item.name}</W_NAME>` +
    `<UNIT_ID>${item.unitId}</UNIT_ID>` +
    `<UNIT_TXT>${item.unitText ?? ''}</UNIT_TXT>` +
    `<QUANTITY>${item.quantity}</QUANTITY>` +
    `<PRICE>${item.price}</PRICE>` +
    `<STATUS>${item.status ?? 1}</STATUS>` +
    `<AMOUNT>${item.amount}</AMOUNT>` +
    `<BAR_CODE>${item.barCode ?? ''}</BAR_CODE>` +
    `<A_ID>${item.exciseId ?? 0}</A_ID>` +
    `<VAT_TYPE>${item.vatType}</VAT_TYPE>` +
    `</GOODS>`
  );
}

function waybillBodyXml(wb: WaybillFixture): string {
  const goodsXml = wb.omitGoodsList
    ? ''
    : wb.goods && wb.goods.length > 0
      ? `<GOODS_LIST>${wb.goods.map(goodsItemXml).join('')}</GOODS_LIST>`
      : `<GOODS_LIST />`;

  return (
    `<WAYBILL>` +
    `<SUB_WAYBILLS />` +
    goodsXml +
    `<ID>${wb.id}</ID>` +
    `<TYPE>${wb.type}</TYPE>` +
    `<SELLER_TIN>${wb.sellerTin ?? ''}</SELLER_TIN>` +
    `<SELLER_NAME>${wb.sellerName ?? ''}</SELLER_NAME>` +
    `<SELER_UN_ID>${wb.sellerUnId ?? ''}</SELER_UN_ID>` +
    `<BUYER_TIN>${wb.buyerTin ?? ''}</BUYER_TIN>` +
    `<CHEK_BUYER_TIN>${wb.checkBuyerTin ?? 1}</CHEK_BUYER_TIN>` +
    `<BUYER_NAME>${wb.buyerName ?? ''}</BUYER_NAME>` +
    `<START_ADDRESS>${wb.startAddress ?? ''}</START_ADDRESS>` +
    `<END_ADDRESS>${wb.endAddress ?? ''}</END_ADDRESS>` +
    `<DRIVER_TIN>${wb.driverTin ?? ''}</DRIVER_TIN>` +
    `<CHEK_DRIVER_TIN>${wb.checkDriverTin ?? 1}</CHEK_DRIVER_TIN>` +
    `<DRIVER_NAME>${wb.driverName ?? ''}</DRIVER_NAME>` +
    `<TRANSPORT_COAST>${wb.transportCost ?? 0}</TRANSPORT_COAST>` +
    `<RECEPTION_INFO>${wb.receptionInfo ?? ''}</RECEPTION_INFO>` +
    `<RECEIVER_INFO>${wb.receiverInfo ?? ''}</RECEIVER_INFO>` +
    `<CREATE_DATE>${wb.createDate ?? ''}</CREATE_DATE>` +
    `<BEGIN_DATE>${wb.beginDate ?? ''}</BEGIN_DATE>` +
    `<ACTIVATE_DATE>${wb.activateDate ?? ''}</ACTIVATE_DATE>` +
    `<DELIVERY_DATE>${wb.deliveryDate ?? ''}</DELIVERY_DATE>` +
    `<CLOSE_DATE>${wb.closeDate ?? ''}</CLOSE_DATE>` +
    `<STATUS>${wb.status}</STATUS>` +
    `<PAR_ID>${wb.parentId ?? ''}</PAR_ID>` +
    `<FULL_AMOUNT>${wb.fullAmount}</FULL_AMOUNT>` +
    `<CAR_NUMBER>${wb.carNumber ?? ''}</CAR_NUMBER>` +
    `<WAYBILL_NUMBER>${wb.waybillNumber ?? ''}</WAYBILL_NUMBER>` +
    `<S_USER_ID>${wb.serviceUserId ?? ''}</S_USER_ID>` +
    `<TRAN_COST_PAYER>${wb.transportCostPayer ?? 2}</TRAN_COST_PAYER>` +
    `<TRANS_ID>${wb.transportTypeId ?? 1}</TRANS_ID>` +
    `<TRANS_TXT>${wb.transportText ?? ''}</TRANS_TXT>` +
    `<COMMENT>${wb.comment ?? ''}</COMMENT>` +
    `<CATEGORY>${wb.category ?? 0}</CATEGORY>` +
    `<IS_MED>${wb.isMed ?? 0}</IS_MED>` +
    `<IS_CONFIRMED>${wb.isConfirmed ?? 0}</IS_CONFIRMED>` +
    `<CONFIRMATION_DATE>${wb.confirmationDate ?? ''}</CONFIRMATION_DATE>` +
    `</WAYBILL>`
  );
}

export function getWaybillResponseXml(
  operation: 'get_waybill' | 'get_waybill_by_number',
  waybill: WaybillFixture | null,
): string {
  const inner = waybill === null ? '<WAYBILL />' : waybillBodyXml(waybill);
  return soapEnvelope(
    `<${operation}Response xmlns="http://tempuri.org/">` +
      `<${operation}Result>${inner}</${operation}Result>` +
      `</${operation}Response>`,
  );
}

export function getWaybillsListResponseXml(
  operation: 'get_waybills' | 'get_buyer_waybills',
  waybills: readonly WaybillFixture[],
): string {
  const listInner =
    waybills.length === 0
      ? '<WAYBILL_LIST />'
      : `<WAYBILL_LIST>${waybills
          .map((wb) => waybillBodyXml({ ...wb, omitGoodsList: true }))
          .join('')}</WAYBILL_LIST>`;

  return soapEnvelope(
    `<${operation}Response xmlns="http://tempuri.org/">` +
      `<${operation}Result>${listInner}</${operation}Result>` +
      `</${operation}Response>`,
  );
}
