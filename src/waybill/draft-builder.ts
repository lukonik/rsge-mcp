import { z } from 'zod';
import { escapeXml } from '../soap/xml.js';

const ISO_LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const GEORGIAN_BUYER_TIN_PATTERN = /^\d{9}$|^\d{11}$/;
const GEORGIAN_DRIVER_TIN_PATTERN = /^\d{11}$/;
const DECIMAL_STRING_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export interface ExactDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

export function parseDecimal(value: number | string): ExactDecimal {
  const raw = typeof value === 'number' ? String(value) : value.trim();
  const match = DECIMAL_STRING_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`Invalid decimal value: "${raw}"`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = match[2]!;
  const fracPart = match[3] ?? '';
  const exponent = match[4] !== undefined ? Number.parseInt(match[4], 10) : 0;

  const combinedDigits = `${intPart}${fracPart}`;
  const rawScale = fracPart.length - exponent;

  if (rawScale < 0) {
    const scaleFactor = 10n ** BigInt(-rawScale);
    return {
      unscaled: sign * BigInt(combinedDigits) * scaleFactor,
      scale: 0,
    };
  }

  return {
    unscaled: sign * BigInt(combinedDigits),
    scale: rawScale,
  };
}

export function multiplyDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  return {
    unscaled: left.unscaled * right.unscaled,
    scale: left.scale + right.scale,
  };
}

export function roundDecimalHalfAwayFromZero(
  decimal: ExactDecimal,
  targetScale: number,
): ExactDecimal {
  if (decimal.scale === targetScale) {
    return decimal;
  }

  if (decimal.scale < targetScale) {
    const factor = 10n ** BigInt(targetScale - decimal.scale);
    return {
      unscaled: decimal.unscaled * factor,
      scale: targetScale,
    };
  }

  const diff = decimal.scale - targetScale;
  const factor = 10n ** BigInt(diff);
  const isNegative = decimal.unscaled < 0n;
  const absUnscaled = isNegative ? -decimal.unscaled : decimal.unscaled;
  const quotient = absUnscaled / factor;
  const remainder = absUnscaled % factor;
  const half = factor / 2n;
  const roundedAbs = remainder >= half ? quotient + 1n : quotient;

  return {
    unscaled: isNegative ? -roundedAbs : roundedAbs,
    scale: targetScale,
  };
}

export function addSameScaleDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  const maxScale = Math.max(left.scale, right.scale);
  const leftScaled =
    left.scale === maxScale
      ? left.unscaled
      : left.unscaled * 10n ** BigInt(maxScale - left.scale);
  const rightScaled =
    right.scale === maxScale
      ? right.unscaled
      : right.unscaled * 10n ** BigInt(maxScale - right.scale);

  return {
    unscaled: leftScaled + rightScaled,
    scale: maxScale,
  };
}

export function formatDecimal(decimal: ExactDecimal): string {
  const isNegative = decimal.unscaled < 0n;
  const absDigits = (isNegative ? -decimal.unscaled : decimal.unscaled).toString();

  if (decimal.scale === 0) {
    return `${isNegative ? '-' : ''}${absDigits}`;
  }

  const padded = absDigits.padStart(decimal.scale + 1, '0');
  const intPart = padded.slice(0, padded.length - decimal.scale);
  const fracPart = padded.slice(padded.length - decimal.scale);
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

export function formatDecimalTrimmed(decimal: ExactDecimal): string {
  if (decimal.unscaled === 0n) {
    return '0';
  }
  const formatted = formatDecimal(decimal);
  if (!formatted.includes('.')) {
    return formatted;
  }
  return formatted.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatDecimalMinScale(
  decimal: ExactDecimal,
  minScale: number,
): string {
  const trimmed = formatDecimalTrimmed(decimal);
  if (minScale <= 0) {
    return trimmed;
  }
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex === -1) {
    return `${trimmed}.${'0'.repeat(minScale)}`;
  }
  const existingDecimals = trimmed.length - dotIndex - 1;
  if (existingDecimals >= minScale) {
    return trimmed;
  }
  return `${trimmed}${'0'.repeat(minScale - existingDecimals)}`;
}

export const draftLineItemInputSchema = z
  .object({
    id: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe(
        'საქონლის პოზიციის ID (0 ახალი პოზიციისთვის, არსებული ID რედაქტირებისთვის). ' +
          'Line Item ID (0 for a new Line Item, existing ID when updating a Draft Waybill).',
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .describe(
        'საქონლის დასახელება (W_NAME). Line Item name (UTF-8 Georgian/Latin supported).',
      ),
    unitId: z
      .number()
      .int()
      .positive()
      .describe(
        'ზომის ერთეულის ID RS.ge ცნობარიდან (მაგ. 1=ცალი, 99=სხვა). ' +
          'Measurement unit ID from RS.ge Reference Data (e.g. 1=piece, 99=Other).',
      ),
    unitText: z
      .string()
      .trim()
      .optional()
      .describe(
        'ზომის ერთეულის ტექსტური დასახელება (სავალდებულოა როცა unitId=99). ' +
          'Custom measurement unit text (required when unitId is 99).',
      ),
    quantity: z
      .number()
      .finite()
      .positive()
      .describe('საქონლის რაოდენობა (დადებითი რიცხვი). Line Item quantity (> 0).'),
    unitPrice: z
      .number()
      .finite()
      .nonnegative()
      .describe('ერთეულის ფასი ლარში (>= 0). Line Item unit price in GEL (>= 0).'),
    vatType: z
      .union([z.literal(0), z.literal(1), z.literal(2)])
      .optional()
      .default(0)
      .describe(
        'დღგ-ის ტიპი: 0=ჩვეულებრივი (18%), 1=ნულოვანი (0%), 2=დაუბეგრავი. ' +
          'VAT type: 0=standard (18%), 1=zero-rated (0%), 2=VAT-exempt.',
      ),
    barcode: z
      .string()
      .trim()
      .optional()
      .describe('შტრიხკოდი ან არტიკული (არასავალდებულო). Optional barcode or item code.'),
    status: z
      .union([z.literal(1), z.literal(-1)])
      .optional()
      .default(1)
      .describe(
        'საქონლის პოზიციის სტატუსი: 1=აქტიური, -1=წაშლა რედაქტირებისას. ' +
          'Line Item status: 1=active, -1=remove existing Line Item during Draft update.',
      ),
  })
  .superRefine((item, ctx) => {
    if (item.unitId === 99 && (!item.unitText || item.unitText.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['unitText'],
        message:
          'unitText სავალდებულოა, როცა unitId არის 99 (სხვა). ' +
          'unitText is required when unitId is 99 (Other).',
      });
    }
    if (item.status === -1 && item.id === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message:
          'წასაშლელი საქონლის პოზიციას (status=-1) უნდა ჰქონდეს არსებული ID (> 0). ' +
          'A Line Item marked for deletion (status=-1) must specify an existing id (> 0).',
      });
    }
  });

export const saveWaybillDraftInputSchema = z
  .object({
    waybillId: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe(
        'არსებული შენახული ზედნადების ID რედაქტირებისთვის (0 ან გამოტოვება ახალი ზედნადების შესაქმნელად). ' +
          'Existing Draft Waybill ID to update (omit or pass 0 to create a new Draft Waybill).',
      ),
    waybillType: z
      .number()
      .int()
      .min(1)
      .max(6)
      .describe(
        'ზედნადების ტიპი RS.ge ცნობარიდან: 1=შიდა გადაზიდვა, 2=ტრანსპორტირებით, 3=ტრანსპორტირების გარეშე, 4=დისტრიბუცია, 5=უკან დაბრუნება. ' +
          'Waybill Type ID from Reference Data: 1=Internal Transfer, 2=Delivery with Transportation, 3=Delivery without Transportation, 4=Distribution, 5=Return.',
      ),
    buyerTin: z
      .string()
      .trim()
      .optional()
      .describe(
        'მყიდველის საიდენტიფიკაციო კოდი (9-ნიშნა იურიდიული პირისთვის, 11-ნიშნა ფიზიკური პირისთვის). ' +
          'Buyer TIN (9 digits for legal entities, 11 digits for individuals; omit for Internal Transfer).',
      ),
    buyerName: z
      .string()
      .trim()
      .optional()
      .describe('მყიდველის დასახელება (არასავალდებულო). Optional Buyer name.'),
    buyerIsGeorgian: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'არის თუ არა მყიდველი საქართველოს გადასახადის გადამხდელი/მოქალაქე (ნაგულისხმევი: true). ' +
          'Whether the Buyer is a Georgian Taxpayer/citizen (maps to CHEK_BUYER_TIN 1/0; default true).',
      ),
    startAddress: z
      .string()
      .trim()
      .optional()
      .describe(
        'ტრანსპორტირების დაწყების მისამართი. Transport start address.',
      ),
    endAddress: z
      .string()
      .trim()
      .optional()
      .describe(
        'ტრანსპორტირების დასრულების მისამართი. Transport destination address.',
      ),
    driverTin: z
      .string()
      .trim()
      .optional()
      .describe(
        'მძღოლის საიდენტიფიკაციო კოდი (11-ნიშნა საქართველოს მოქალაქისთვის). ' +
          'Driver TIN (11 digits for Georgian citizens).',
      ),
    driverName: z
      .string()
      .trim()
      .optional()
      .describe('მძღოლის სახელი და გვარი. Driver full name.'),
    driverIsGeorgian: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'არის თუ არა მძღოლი საქართველოს მოქალაქე (ნაგულისხმევი: true). ' +
          'Whether the driver is a Georgian citizen (maps to CHEK_DRIVER_TIN 1/0; default true).',
      ),
    vehicleNumber: z
      .string()
      .trim()
      .optional()
      .describe(
        'ავტომობილის ნომერი ტირეების გარეშე (მაგ. AA123BB). ' +
          'Vehicle plate number without dashes (e.g. AA123BB).',
      ),
    transportTypeId: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'ტრანსპორტირების ტიპის ID (მაგ. 1=საავტომობილო, 4=სხვა, 0=ტრანსპორტირების გარეშე). ' +
          'Transport Type ID from Reference Data (defaults to 0 for Type 3, 1 otherwise).',
      ),
    transportText: z
      .string()
      .trim()
      .optional()
      .describe(
        'ტრანსპორტირების ტიპის ტექსტური აღწერა (სავალდებულოა როცა transportTypeId=4). ' +
          'Custom Transport Type description (required when transportTypeId is 4).',
      ),
    transportCost: z
      .number()
      .finite()
      .nonnegative()
      .optional()
      .default(0)
      .describe(
        'ტრანსპორტირების ხარჯი ლარში (ნაგულისხმევი: 0). Transport cost in GEL (default 0).',
      ),
    transportCostPayer: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        'ტრანსპორტირების ხარჯის გადამხდელი: 1=მყიდველი, 2=გამყიდველი. ' +
          'Transport cost payer: 1=Buyer, 2=Seller.',
      ),
    beginDate: z
      .string()
      .trim()
      .regex(
        ISO_LOCAL_DATETIME_PATTERN,
        'beginDate უნდა იყოს yyyy-MM-ddTHH:mm:ss ფორმატში / beginDate must match yyyy-MM-ddTHH:mm:ss',
      )
      .optional()
      .describe(
        'ტრანსპორტირების დაწყების თარიღი (yyyy-MM-ddTHH:mm:ss). ' +
          'Transport begin date-time in local ISO format (yyyy-MM-ddTHH:mm:ss).',
      ),
    deliveryDate: z
      .string()
      .trim()
      .regex(
        ISO_LOCAL_DATETIME_PATTERN,
        'deliveryDate უნდა იყოს yyyy-MM-ddTHH:mm:ss ფორმატში / deliveryDate must match yyyy-MM-ddTHH:mm:ss',
      )
      .optional()
      .describe(
        'მიწოდების თარიღი (yyyy-MM-ddTHH:mm:ss). ' +
          'Delivery date-time in local ISO format (yyyy-MM-ddTHH:mm:ss).',
      ),
    receptionInfo: z
      .string()
      .trim()
      .optional()
      .describe('გამცემის ინფორმაცია (არასავალდებულო). Optional handover info.'),
    receiverInfo: z
      .string()
      .trim()
      .optional()
      .describe('მიმღების ინფორმაცია (არასავალდებულო). Optional receiver info.'),
    comment: z
      .string()
      .trim()
      .optional()
      .describe('ზედნადების კომენტარი (არასავალდებულო). Optional Waybill comment.'),
    lineItems: z
      .array(draftLineItemInputSchema)
      .min(
        1,
        'ზედნადებში უნდა იყოს მინიმუმ ერთი საქონლის პოზიცია / At least one Line Item is required',
      )
      .describe(
        'საქონლის პოზიციების სია (ჯამები გამოითვლება სერვერის მხარეს). ' +
          'List of Waybill Line Items (subtotals and FULL_AMOUNT are computed server-side).',
      ),
  })
  .superRefine((input, ctx) => {
    const activeItems = input.lineItems.filter((item) => item.status === 1);
    if (activeItems.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['lineItems'],
        message:
          'ზედნადებში უნდა იყოს მინიმუმ ერთი აქტიური საქონლის პოზიცია (status=1). ' +
          'Waybill must include at least one active Line Item (status=1).',
      });
    }

    if (
      input.buyerIsGeorgian &&
      input.buyerTin !== undefined &&
      input.buyerTin.length > 0 &&
      !GEORGIAN_BUYER_TIN_PATTERN.test(input.buyerTin)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['buyerTin'],
        message:
          'ქართველი მყიდველის საიდენტიფიკაციო კოდი (TIN) უნდა იყოს 9 ან 11 ციფრი. ' +
          'Georgian Buyer TIN must be 9 digits (legal entity) or 11 digits (individual).',
      });
    }

    if (
      input.driverIsGeorgian &&
      input.driverTin !== undefined &&
      input.driverTin.length > 0 &&
      !GEORGIAN_DRIVER_TIN_PATTERN.test(input.driverTin)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['driverTin'],
        message:
          'საქართველოს მოქალაქე მძღოლის საიდენტიფიკაციო კოდი უნდა იყოს 11 ციფრი. ' +
          'Georgian Driver TIN must be 11 digits.',
      });
    }

    if (
      input.transportTypeId === 4 &&
      (!input.transportText || input.transportText.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['transportText'],
        message:
          'transportText სავალდებულოა, როცა transportTypeId არის 4 (სხვა). ' +
          'transportText is required when transportTypeId is 4 (Other).',
      });
    }
  });

export type SaveWaybillDraftInput = z.infer<typeof saveWaybillDraftInputSchema>;
export type DraftLineItemInput = z.infer<typeof draftLineItemInputSchema>;

export interface SellerIdentity {
  readonly unId: number;
  readonly serviceUserId: number;
}

export interface ComputedDraftLineItem {
  readonly id: number;
  readonly name: string;
  readonly unitId: number;
  readonly unitText?: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly amount: number;
  readonly amountFormatted: string;
  readonly vatType: 0 | 1 | 2;
  readonly barcode?: string;
  readonly status: 1 | -1;
}

export interface BuiltDraftWaybill {
  readonly waybillXml: string;
  readonly fullAmount: number;
  readonly fullAmountFormatted: string;
  readonly lineItems: readonly ComputedDraftLineItem[];
}

function xmlTag(tag: string, value: string | number): string {
  return `<${tag}>${escapeXml(String(value))}</${tag}>`;
}

export function buildDraftWaybillXml(
  input: SaveWaybillDraftInput,
  seller: SellerIdentity,
): BuiltDraftWaybill {
  let fullAmountDecimal: ExactDecimal = { unscaled: 0n, scale: 2 };
  const computedLineItems: ComputedDraftLineItem[] = [];
  const goodsXmlParts: string[] = [];

  for (const item of input.lineItems) {
    const qtyDecimal = parseDecimal(item.quantity);
    const priceDecimal = parseDecimal(item.unitPrice);
    const rawAmount = multiplyDecimals(qtyDecimal, priceDecimal);
    const amountDecimal = roundDecimalHalfAwayFromZero(rawAmount, 2);
    const amountFormatted = formatDecimal(amountDecimal);
    const amountNumber = Number(amountFormatted);

    if (item.status === 1) {
      fullAmountDecimal = addSameScaleDecimals(fullAmountDecimal, amountDecimal);
    }

    const quantityXml = formatDecimalTrimmed(qtyDecimal);
    const priceXml = formatDecimalMinScale(priceDecimal, 2);

    computedLineItems.push({
      id: item.id,
      name: item.name,
      unitId: item.unitId,
      ...(item.unitText !== undefined && item.unitText.length > 0
        ? { unitText: item.unitText }
        : {}),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: amountNumber,
      amountFormatted,
      vatType: item.vatType,
      ...(item.barcode !== undefined && item.barcode.length > 0
        ? { barcode: item.barcode }
        : {}),
      status: item.status,
    });

    goodsXmlParts.push(
      '<GOODS>' +
        xmlTag('ID', item.id) +
        xmlTag('W_NAME', item.name) +
        xmlTag('UNIT_ID', item.unitId) +
        xmlTag('UNIT_TXT', item.unitText ?? '') +
        xmlTag('QUANTITY', quantityXml) +
        xmlTag('PRICE', priceXml) +
        xmlTag('STATUS', item.status) +
        xmlTag('AMOUNT', amountFormatted) +
        xmlTag('BAR_CODE', item.barcode ?? '') +
        xmlTag('A_ID', 0) +
        xmlTag('VAT_TYPE', item.vatType) +
        '</GOODS>',
    );
  }

  const fullAmountFormatted = formatDecimal(fullAmountDecimal);
  const fullAmount = Number(fullAmountFormatted);

  const transportCostDecimal = parseDecimal(input.transportCost);
  const transportCostXml =
    transportCostDecimal.unscaled === 0n
      ? '0'
      : formatDecimalMinScale(transportCostDecimal, 2);

  const isWithoutTransport = input.waybillType === 3;
  const resolvedTransportTypeId =
    input.transportTypeId ?? (isWithoutTransport ? 0 : 1);
  const resolvedTransportCostPayer =
    input.transportCostPayer ?? (isWithoutTransport ? '' : 2);

  const waybillXml =
    '<WAYBILL>' +
    '<SUB_WAYBILLS></SUB_WAYBILLS>' +
    `<GOODS_LIST>${goodsXmlParts.join('')}</GOODS_LIST>` +
    xmlTag('ID', input.waybillId) +
    xmlTag('TYPE', input.waybillType) +
    xmlTag('BUYER_TIN', input.buyerTin ?? '') +
    xmlTag('CHEK_BUYER_TIN', input.buyerIsGeorgian ? 1 : 0) +
    xmlTag('BUYER_NAME', input.buyerName ?? '') +
    xmlTag('START_ADDRESS', input.startAddress ?? '') +
    xmlTag('END_ADDRESS', input.endAddress ?? '') +
    xmlTag('DRIVER_TIN', input.driverTin ?? '') +
    xmlTag('CHEK_DRIVER_TIN', input.driverIsGeorgian ? 1 : 0) +
    xmlTag('DRIVER_NAME', input.driverName ?? '') +
    xmlTag('TRANSPORT_COAST', transportCostXml) +
    xmlTag('RECEPTION_INFO', input.receptionInfo ?? '') +
    xmlTag('RECEIVER_INFO', input.receiverInfo ?? '') +
    xmlTag('DELIVERY_DATE', input.deliveryDate ?? '') +
    xmlTag('STATUS', 0) +
    xmlTag('SELER_UN_ID', seller.unId) +
    xmlTag('PAR_ID', '') +
    xmlTag('FULL_AMOUNT', fullAmountFormatted) +
    xmlTag('CAR_NUMBER', input.vehicleNumber ?? '') +
    xmlTag('WAYBILL_NUMBER', '') +
    xmlTag('S_USER_ID', seller.serviceUserId) +
    xmlTag('BEGIN_DATE', input.beginDate ?? '') +
    xmlTag('TRAN_COST_PAYER', resolvedTransportCostPayer) +
    xmlTag('TRANS_ID', resolvedTransportTypeId) +
    xmlTag('TRANS_TXT', input.transportText ?? '') +
    xmlTag('COMMENT', input.comment ?? '') +
    xmlTag('CATEGORY', 0) +
    xmlTag('IS_MED', 0) +
    '</WAYBILL>';

  return {
    waybillXml,
    fullAmount,
    fullAmountFormatted,
    lineItems: computedLineItems,
  };
}
