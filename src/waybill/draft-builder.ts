import { z } from 'zod';
import { escapeXml } from '../soap/xml.js';
import {
  GEORGIAN_DRIVER_TIN_PATTERN,
  GEORGIAN_TIN_PATTERN,
  createIsoLocalDateTimeSchema,
} from '../validation/common.js';
import {
  addSameScaleDecimals,
  formatDecimal,
  formatDecimalMinScale,
  formatDecimalTrimmed,
  multiplyDecimals,
  parseDecimal,
  roundDecimalHalfAwayFromZero,
  type ExactDecimal,
} from './decimal.js';

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
      .max(5)
      .describe(
        'ზედნადების ტიპი RS.ge ცნობარიდან: 1=შიდა გადაზიდვა, 2=ტრანსპორტირებით, 3=ტრანსპორტირების გარეშე, 4=დისტრიბუცია, 5=უკან დაბრუნება (ქვე-ზედნადები v1-ში არ არის მხარდაჭერილი). ' +
          'Waybill Type ID from Reference Data: 1=Internal Transfer, 2=Delivery with Transportation, 3=Delivery without Transportation, 4=Distribution, 5=Return (Sub-waybill Type 6 is out of scope in v1).',
      ),
    buyerTin: z
      .string()
      .trim()
      .optional()
      .describe(
        'მყიდველის საიდენტიფიკაციო კოდი (9-ნიშნა იურიდიული პირისთვის, 11-ნიშნა ფიზიკური პირისთვის). ' +
          'Buyer TIN (9 digits for legal entities, 11 digits for individuals; required for Types 2, 3, 5; omit for Type 1 Internal Transfer).',
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
        'ტრანსპორტირების დაწყების მისამართი (სავალდებულოა 1 და 2 ტიპის ზედნადებებისთვის). ' +
          'Transport start address (required for Waybill Types 1 and 2).',
      ),
    endAddress: z
      .string()
      .trim()
      .optional()
      .describe(
        'ტრანსპორტირების დასრულების მისამართი (სავალდებულოა 1 და 2 ტიპის ზედნადებებისთვის). ' +
          'Transport destination address (required for Waybill Types 1 and 2).',
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
      .min(0)
      .max(7)
      .optional()
      .describe(
        'ტრანსპორტირების ტიპის ID (1..7 ტრანსპორტირებით ზედნადებებისთვის, მაგ. 1=საავტომობილო, 4=სხვა; 0 მხოლოდ 3 ტიპისთვის ტრანსპორტირების გარეშე). ' +
          'Transport Type ID from Reference Data (1..7 for transport Waybill Types; 0 only for Type 3 without transport; defaults to 0 for Type 3, 1 otherwise).',
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
    beginDate: createIsoLocalDateTimeSchema('beginDate')
      .optional()
      .describe(
        'ტრანსპორტირების დაწყების თარიღი (yyyy-MM-ddTHH:mm:ss). ' +
          'Transport begin date-time in local ISO format (yyyy-MM-ddTHH:mm:ss).',
      ),
    deliveryDate: createIsoLocalDateTimeSchema('deliveryDate')
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

    const hasBuyerTin =
      input.buyerTin !== undefined && input.buyerTin.length > 0;

    if (
      (input.waybillType === 2 ||
        input.waybillType === 3 ||
        input.waybillType === 5) &&
      !hasBuyerTin
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['buyerTin'],
        message:
          'მყიდველის საიდენტიფიკაციო კოდი (buyerTin) სავალდებულოა 2, 3 და 5 ტიპის ზედნადებებისთვის. ' +
          'buyerTin is required for Waybill Types 2, 3, and 5.',
      });
    }

    if (input.waybillType === 1 && hasBuyerTin) {
      ctx.addIssue({
        code: 'custom',
        path: ['buyerTin'],
        message:
          'შიდა გადაზიდვის ზედნადებში (waybillType=1) მყიდველის საიდენტიფიკაციო კოდი (buyerTin) არ უნდა მიეთითოს. ' +
          'buyerTin must be omitted for Internal Transfer (waybillType=1) Waybills.',
      });
    }

    if (
      input.buyerIsGeorgian &&
      hasBuyerTin &&
      !GEORGIAN_TIN_PATTERN.test(input.buyerTin!)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['buyerTin'],
        message:
          'ქართველი მყიდველის საიდენტიფიკაციო კოდი (TIN) უნდა იყოს 9 ან 11 ციფრი. ' +
          'Georgian Buyer TIN must be 9 digits (legal entity) or 11 digits (individual).',
      });
    }

    if (input.waybillType === 1 || input.waybillType === 2) {
      if (!input.startAddress || input.startAddress.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['startAddress'],
          message:
            'ტრანსპორტირების დაწყების მისამართი (startAddress) სავალდებულოა 1 და 2 ტიპის ზედნადებებისთვის. ' +
            'startAddress is required for Waybill Types 1 and 2.',
        });
      }
      if (!input.endAddress || input.endAddress.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['endAddress'],
          message:
            'ტრანსპორტირების დასრულების მისამართი (endAddress) სავალდებულოა 1 და 2 ტიპის ზედნადებებისთვის. ' +
            'endAddress is required for Waybill Types 1 and 2.',
        });
      }
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

    if (input.waybillType !== 3 && input.transportTypeId === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['transportTypeId'],
        message:
          'transportTypeId=0 დასაშვებია მხოლოდ ტრანსპორტირების გარეშე ზედნადებისთვის (waybillType=3); სხვა ტიპებისთვის მიუთითეთ 1..7. ' +
          'transportTypeId=0 is only valid for Delivery without Transportation (waybillType=3); provide 1..7 for transport Waybill Types.',
      });
    }

    if (
      input.waybillType === 3 &&
      input.transportTypeId !== undefined &&
      input.transportTypeId !== 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['transportTypeId'],
        message:
          'ტრანსპორტირების გარეშე ზედნადებისთვის (waybillType=3) transportTypeId უნდა იყოს 0 ან გამოტოვებული. ' +
          'For Delivery without Transportation (waybillType=3), transportTypeId must be 0 or omitted.',
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
