import { z } from 'zod';
import {
  TRANSPORT_TYPE_ENGLISH_NAMES,
  WAYBILL_TYPE_ENGLISH_NAMES,
} from '../reference/index.js';
import { toArray } from '../soap/index.js';
import {
  VAT_TYPE_LABELS,
  getWaybillConfirmationInfo,
  getWaybillStatusInfo,
  type Waybill,
  type WaybillLineItem,
  type WaybillSummary,
} from './types.js';

type XmlRecord = Record<string, unknown>;

function isRecord(value: unknown): value is XmlRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function optionalInt(value: unknown): number | undefined {
  const text = optionalString(value);
  if (text === undefined) {
    return undefined;
  }
  if (!/^-?\d+$/.test(text)) {
    return undefined;
  }
  const parsed = Number.parseInt(text, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const text = optionalString(value);
  if (text === undefined) {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = optionalString(value)?.toLowerCase();
  if (text === '1' || text === 'true') {
    return true;
  }
  if (text === '0' || text === 'false') {
    return false;
  }
  return undefined;
}

export function parseWaybillLineItem(raw: unknown): WaybillLineItem | null {
  if (!isRecord(raw)) {
    return null;
  }

  const name = optionalString(raw.W_NAME);
  if (name === undefined) {
    return null;
  }

  const id = optionalInt(raw.ID) ?? 0;
  const unitId = optionalInt(raw.UNIT_ID) ?? 0;
  const unitText = optionalString(raw.UNIT_TXT);
  const quantity = optionalNumber(raw.QUANTITY) ?? 0;
  const unitPrice = optionalNumber(raw.PRICE) ?? 0;
  const amount = optionalNumber(raw.AMOUNT) ?? 0;
  const status = optionalInt(raw.STATUS);
  const barCode = optionalString(raw.BAR_CODE);
  const exciseId = optionalInt(raw.A_ID);
  const vatType = optionalInt(raw.VAT_TYPE) ?? 0;
  const vatTypeLabel = VAT_TYPE_LABELS[vatType];

  return {
    id,
    name,
    unitId,
    ...(unitText !== undefined ? { unitText } : {}),
    quantity,
    unitPrice,
    amount,
    ...(status !== undefined ? { status } : {}),
    ...(barCode !== undefined ? { barCode } : {}),
    ...(exciseId !== undefined ? { exciseId } : {}),
    vatType,
    ...(vatTypeLabel !== undefined ? { vatTypeLabel } : {}),
  };
}

export function parseWaybillSummary(raw: unknown): WaybillSummary | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = optionalInt(raw.ID);
  if (id === undefined || id <= 0) {
    return null;
  }

  const type = optionalInt(raw.TYPE) ?? 0;
  const typeName = WAYBILL_TYPE_ENGLISH_NAMES[type];
  const status = optionalInt(raw.STATUS) ?? 0;
  const statusInfo = getWaybillStatusInfo(status);
  const waybillNumber = optionalString(raw.WAYBILL_NUMBER) ?? '';
  const sellerTin = optionalString(raw.SELLER_TIN);
  const sellerName = optionalString(raw.SELLER_NAME);
  const sellerUnId = optionalInt(raw.SELER_UN_ID ?? raw.SELLER_UN_ID);
  const buyerTin = optionalString(raw.BUYER_TIN);
  const buyerName = optionalString(raw.BUYER_NAME);
  const fullAmount = optionalNumber(raw.FULL_AMOUNT) ?? 0;
  const transportCost = optionalNumber(raw.TRANSPORT_COAST ?? raw.TRANSPORT_COST);
  const carNumber = optionalString(raw.CAR_NUMBER);
  const driverTin = optionalString(raw.DRIVER_TIN);
  const driverName = optionalString(raw.DRIVER_NAME);
  const startAddress = optionalString(raw.START_ADDRESS);
  const endAddress = optionalString(raw.END_ADDRESS);
  const createDate = optionalString(raw.CREATE_DATE);
  const beginDate = optionalString(raw.BEGIN_DATE);
  const activateDate = optionalString(raw.ACTIVATE_DATE);
  const deliveryDate = optionalString(raw.DELIVERY_DATE);
  const closeDate = optionalString(raw.CLOSE_DATE);
  const isConfirmedCode = optionalInt(raw.IS_CONFIRMED);
  const confirmationStatus =
    isConfirmedCode !== undefined
      ? getWaybillConfirmationInfo(isConfirmedCode)
      : undefined;
  const confirmationDate = optionalString(raw.CONFIRMATION_DATE);
  const comment = optionalString(raw.COMMENT);
  const serviceUserId = optionalInt(raw.S_USER_ID);

  return {
    id,
    waybillNumber,
    type,
    ...(typeName !== undefined ? { typeName } : {}),
    status: statusInfo.code,
    statusGeorgian: statusInfo.georgian,
    statusEnglish: statusInfo.english,
    ...(sellerTin !== undefined ? { sellerTin } : {}),
    ...(sellerName !== undefined ? { sellerName } : {}),
    ...(sellerUnId !== undefined ? { sellerUnId } : {}),
    ...(buyerTin !== undefined ? { buyerTin } : {}),
    ...(buyerName !== undefined ? { buyerName } : {}),
    fullAmount,
    ...(transportCost !== undefined ? { transportCost } : {}),
    ...(carNumber !== undefined ? { carNumber } : {}),
    ...(driverTin !== undefined ? { driverTin } : {}),
    ...(driverName !== undefined ? { driverName } : {}),
    ...(startAddress !== undefined ? { startAddress } : {}),
    ...(endAddress !== undefined ? { endAddress } : {}),
    ...(createDate !== undefined ? { createDate } : {}),
    ...(beginDate !== undefined ? { beginDate } : {}),
    ...(activateDate !== undefined ? { activateDate } : {}),
    ...(deliveryDate !== undefined ? { deliveryDate } : {}),
    ...(closeDate !== undefined ? { closeDate } : {}),
    ...(confirmationStatus !== undefined ? { confirmationStatus } : {}),
    ...(confirmationDate !== undefined ? { confirmationDate } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(serviceUserId !== undefined ? { serviceUserId } : {}),
  };
}

export function parseWaybillDetail(raw: unknown): Waybill | null {
  const summary = parseWaybillSummary(raw);
  if (summary === null || !isRecord(raw)) {
    return null;
  }

  const parentId = optionalInt(raw.PAR_ID);
  const checkBuyerTin = optionalBoolean(raw.CHEK_BUYER_TIN ?? raw.CHECK_BUYER_TIN);
  const checkDriverTin = optionalBoolean(
    raw.CHEK_DRIVER_TIN ?? raw.CHECK_DRIVER_TIN,
  );
  const transportTypeId = optionalInt(raw.TRANS_ID);
  const transportTypeName =
    transportTypeId !== undefined
      ? TRANSPORT_TYPE_ENGLISH_NAMES[transportTypeId]
      : undefined;
  const transportText = optionalString(raw.TRANS_TXT);
  const transportCostPayer = optionalInt(raw.TRAN_COST_PAYER);
  const receptionInfo = optionalString(raw.RECEPTION_INFO);
  const receiverInfo = optionalString(raw.RECEIVER_INFO);
  const category = optionalInt(raw.CATEGORY);
  const isMedicine = optionalBoolean(raw.IS_MED);
  const customStatus = optionalInt(raw.CUST_STATUS);
  const customName = optionalString(raw.CUST_NAME);

  const goodsContainer = raw.GOODS_LIST;
  const rawGoodsItems = isRecord(goodsContainer)
    ? toArray(goodsContainer.GOODS as unknown | unknown[] | '' | null | undefined)
    : [];

  const lineItems: WaybillLineItem[] = [];
  for (const item of rawGoodsItems) {
    const parsed = parseWaybillLineItem(item);
    if (parsed !== null) {
      lineItems.push(parsed);
    }
  }

  return {
    ...summary,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(checkBuyerTin !== undefined ? { checkBuyerTin } : {}),
    ...(checkDriverTin !== undefined ? { checkDriverTin } : {}),
    ...(transportTypeId !== undefined ? { transportTypeId } : {}),
    ...(transportTypeName !== undefined ? { transportTypeName } : {}),
    ...(transportText !== undefined ? { transportText } : {}),
    ...(transportCostPayer !== undefined ? { transportCostPayer } : {}),
    ...(receptionInfo !== undefined ? { receptionInfo } : {}),
    ...(receiverInfo !== undefined ? { receiverInfo } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(isMedicine !== undefined ? { isMedicine } : {}),
    ...(customStatus !== undefined ? { customStatus } : {}),
    ...(customName !== undefined ? { customName } : {}),
    lineItems,
  };
}

function waybillDetailResultSchema(resultField: string) {
  return z
    .object({
      [resultField]: z.unknown().optional(),
    })
    .transform((response, ctx): Waybill | null => {
      const resultNode = response[resultField];
      if (resultNode === undefined || resultNode === null || resultNode === '') {
        return null;
      }
      if (!isRecord(resultNode)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unexpected ${resultField} structure`,
        });
        return z.NEVER;
      }
      const waybillNode = resultNode.WAYBILL;
      if (
        waybillNode === undefined ||
        waybillNode === null ||
        waybillNode === ''
      ) {
        return null;
      }
      return parseWaybillDetail(waybillNode);
    });
}

function waybillListResultSchema(resultField: string) {
  return z
    .object({
      [resultField]: z.unknown().optional(),
    })
    .transform((response, ctx): WaybillSummary[] => {
      const resultNode = response[resultField];
      if (resultNode === undefined || resultNode === null || resultNode === '') {
        return [];
      }
      if (!isRecord(resultNode)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unexpected ${resultField} structure`,
        });
        return z.NEVER;
      }
      const listNode = resultNode.WAYBILL_LIST;
      if (listNode === undefined || listNode === null || listNode === '') {
        return [];
      }
      if (!isRecord(listNode)) {
        ctx.addIssue({
          code: 'custom',
          message: `Unexpected WAYBILL_LIST structure in ${resultField}`,
        });
        return z.NEVER;
      }

      const rawItems = toArray(
        listNode.WAYBILL as unknown | unknown[] | '' | null | undefined,
      );
      const items: WaybillSummary[] = [];
      for (const item of rawItems) {
        const parsed = parseWaybillSummary(item);
        if (parsed !== null) {
          items.push(parsed);
        }
      }
      return items;
    });
}

export const getWaybillResponseSchema =
  waybillDetailResultSchema('get_waybillResult');

export const getWaybillByNumberResponseSchema = waybillDetailResultSchema(
  'get_waybill_by_numberResult',
);

export const getWaybillsResponseSchema =
  waybillListResultSchema('get_waybillsResult');

export const getBuyerWaybillsResponseSchema = waybillListResultSchema(
  'get_buyer_waybillsResult',
);
