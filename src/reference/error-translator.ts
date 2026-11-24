import type { RsgeErrorCodeItem } from './types.js';

export const IP_ALLOWLIST_AND_CREDS_HINT =
  'გადაამოწმეთ RSGE_SERVICE_USER და RSGE_SERVICE_PASSWORD მონაცემები და დარწმუნდით, რომ თქვენი გამავალი IP მისამართი დამატებულია დაშვებულ IP-ებში RS.ge პორტალის სერვისის მომხმარებლის პარამეტრებში. ' +
  'Verify your RSGE_SERVICE_USER and RSGE_SERVICE_PASSWORD credentials and confirm your outbound IP address is allowlisted for this Service User on the RS.ge portal.';

const ERROR_TYPE_LABELS: Readonly<Record<number, string>> = {
  1: 'Waybill error',
  2: 'Line Item error',
  3: 'Tax Invoice error',
  4: 'Declaration error',
  5: 'Vehicle error',
};

interface KnownErrorMeta {
  readonly fallbackGeorgianText: string;
  readonly englishText: string;
  readonly hint: string;
}

const DEFAULT_CHECK_PARAMS_HINT =
  'გადაამოწმეთ მოთხოვნის პარამეტრები და იხილეთ RS.ge შეცდომის კოდების ცნობარი (rsge://reference/error-codes ან get_reference_data). ' +
  'Verify request parameters and consult the RS.ge error codes Reference Data (rsge://reference/error-codes or get_reference_data).';

export const KNOWN_RSGE_ERRORS: Readonly<Record<number, KnownErrorMeta>> = {
  [-100]: {
    fallbackGeorgianText:
      'სერვისის მომხმარებლის მონაცემები არასწორია ან გამავალი IP მისამართი არ არის დაშვებული',
    englishText:
      'Invalid Service User credentials or outbound IP address is not allowlisted',
    hint: IP_ALLOWLIST_AND_CREDS_HINT,
  },
  [-3]: {
    fallbackGeorgianText: 'სერვისის მომხმარებლის ავტორიზაცია ვერ დადასტურდა',
    englishText: 'Service User authentication failed',
    hint: IP_ALLOWLIST_AND_CREDS_HINT,
  },
  [-101]: {
    fallbackGeorgianText:
      'ზედნადები არ ეკუთვნის ამ გადასახადის გადამხდელს ან გამყიდველის UN ID არ ემთხვევა',
    englishText:
      'Waybill does not belong to this Taxpayer or Seller UN ID mismatch',
    hint:
      'გადაამოწმეთ ზედნადების ID და დარწმუნდით, რომ სწორი გადასახადის გადამხდელის სერვისის მომხმარებლით ხართ ავტორიზებული (check_connection). ' +
      'Verify the Waybill ID and confirm you are authenticated with the owning Taxpayer Service User (check_connection).',
  },
  [-102]: {
    fallbackGeorgianText:
      'XML მოთხოვნის ფორმატი არასწორია ან აკლია სავალდებულო ველები',
    englishText: 'Invalid XML payload or missing required fields',
    hint:
      'გადაამოწმეთ ზედნადების სავალდებულო ველები და XML ფორმატი; საჭიროების შემთხვევაში შეამოწმეთ კავშირი check_connection ინსტრუმენტით. ' +
      'Verify required Waybill fields and XML formatting; run check_connection if Seller UN ID is missing.',
  },
  [-103]: {
    fallbackGeorgianText: 'ზედნადების ID არასწორია ან ვერ მოიძებნა',
    englishText: 'Invalid or nonexistent Waybill ID',
    hint:
      'გადაამოწმეთ ზედნადების ID list_waybills ან get_waybill ინსტრუმენტით. ' +
      'Verify the Waybill ID using list_waybills or get_waybill.',
  },
  [-1]: {
    fallbackGeorgianText:
      'ოპერაცია ვერ შესრულდა ან ზედნადების სტატუსი არ შეესაბამება მოთხოვნილ ქმედებას',
    englishText:
      'Operation failed or Waybill Status does not permit this transition',
    hint:
      'შეამოწმეთ ზედნადების მიმდინარე სტატუსი get_waybill ინსტრუმენტით (მაგ., წაშლა დაშვებულია მხოლოდ შენახულ ზედნადებზე, გაუქმება — გააქტიურებულზე). ' +
      'Check the current Waybill Status via get_waybill (for example, delete requires Draft status and cancel requires Active status).',
  },
  [-2]: {
    fallbackGeorgianText: 'რიცხვითი ან თარიღის ფორმატი არასწორია',
    englishText:
      'Invalid numeric or date format (use dot decimal separator and ISO date)',
    hint:
      'ათწილადი რიცხვებისთვის გამოიყენეთ წერტილი (.) და თარიღებისთვის yyyy-MM-ddTHH:mm:ss ფორმატი. ' +
      'Use dot (.) as the decimal separator and yyyy-MM-ddTHH:mm:ss format for dates.',
  },
  [-1001]: {
    fallbackGeorgianText: 'ზედნადების ტიპი არასწორია',
    englishText: 'Invalid Waybill Type',
    hint:
      'იხილეთ დაშვებული ზედნადების ტიპები rsge://reference/waybill-types რესურსში ან get_reference_data(category="waybill_types") ინსტრუმენტით. ' +
      'Consult valid Waybill Types via rsge://reference/waybill-types or get_reference_data(category="waybill_types").',
  },
  [-1002]: {
    fallbackGeorgianText: 'მყიდველის საიდენტიფიკაციო კოდი არასწორია',
    englishText: 'Invalid Buyer TIN',
    hint:
      'გადაამოწმეთ მყიდველის 9-ნიშნა ან 11-ნიშნა საიდენტიფიკაციო კოდი (TIN) lookup_taxpayer ინსტრუმენტით. ' +
      'Verify the 9-digit or 11-digit Buyer TIN using lookup_taxpayer.',
  },
  [-1003]: {
    fallbackGeorgianText: 'ტრანსპორტირების დაწყების მისამართი არასწორია',
    englishText: 'Invalid or missing transport start address',
    hint:
      'მიუთითეთ ტრანსპორტირების დაწყების სწორი მისამართი. ' +
      'Provide a valid start address for transport.',
  },
  [-1004]: {
    fallbackGeorgianText: 'ტრანსპორტირების დასრულების მისამართი არასწორია',
    englishText: 'Invalid or missing transport destination address',
    hint:
      'მიუთითეთ ტრანსპორტირების დასრულების სწორი მისამართი. ' +
      'Provide a valid destination address for transport.',
  },
  [-1005]: {
    fallbackGeorgianText: 'მძღოლის საიდენტიფიკაციო კოდი არასწორია',
    englishText: 'Invalid Driver TIN',
    hint:
      'მიუთითეთ მძღოლის 11-ნიშნა საიდენტიფიკაციო კოდი ან მონიშნეთ უცხო ქვეყნის მოქალაქე. ' +
      'Provide a valid 11-digit Driver TIN or mark the driver as a foreign citizen.',
  },
  [-1006]: {
    fallbackGeorgianText: 'ავტომობილის ნომერი არასწორია',
    englishText: 'Invalid vehicle plate number',
    hint:
      'მიუთითეთ ავტომობილის ნომერი ტირეების გარეშე (მაგ., AA123BB). ' +
      'Provide a valid vehicle plate number without dashes (e.g., AA123BB).',
  },
  [-1007]: {
    fallbackGeorgianText: 'ტრანსპორტირების ტიპი არასწორია',
    englishText: 'Invalid Transport Type',
    hint:
      'იხილეთ დაშვებული ტრანსპორტირების ტიპები rsge://reference/transport-types რესურსში ან get_reference_data(category="transport_types") ინსტრუმენტით. ' +
      'Consult valid Transport Types via rsge://reference/transport-types or get_reference_data(category="transport_types").',
  },
  [-1008]: {
    fallbackGeorgianText: 'ტრანსპორტირების ხარჯის გადამხდელი არასწორია',
    englishText: 'Invalid transport cost payer value',
    hint:
      'მიუთითეთ 1 (მყიდველი) ან 2 (გამყიდველი). ' +
      'Specify 1 (Buyer) or 2 (Seller) as the transport cost payer.',
  },
  [-1009]: {
    fallbackGeorgianText: 'საქონლის პოზიციების სია ცარიელია',
    englishText: 'Waybill Line Items list is empty',
    hint:
      'დაამატეთ მინიმუმ ერთი საქონლის პოზიცია (Line Item). ' +
      'Include at least one Line Item on the Waybill.',
  },
  [-1010]: {
    fallbackGeorgianText: 'ტრანსპორტირების დაწყების თარიღი არასწორია',
    englishText: 'Invalid transport begin date',
    hint:
      'გამოიყენეთ yyyy-MM-ddTHH:mm:ss ფორმატი. ' +
      'Provide begin date in yyyy-MM-ddTHH:mm:ss format.',
  },
  [-1035]: {
    fallbackGeorgianText:
      'შიდა გადაზიდვის ზედნადებში მყიდველის საიდენტიფიკაციო კოდი არ უნდა მიეთითოს',
    englishText:
      'Buyer TIN must be empty for Internal Transfer (Type 1) Waybills',
    hint:
      'შიდა გადაზიდვის (ტიპი 1) ზედნადებისთვის დატოვეთ მყიდველის TIN ცარიელი. ' +
      'Omit Buyer TIN for Internal Transfer (Type 1) Waybills.',
  },
  [-1036]: {
    fallbackGeorgianText:
      'ტრანსპორტირების გარეშე ზედნადებისთვის ტრანსპორტირების ველები არ უნდა იყოს შევსებული',
    englishText:
      'Transport fields must be empty for Delivery without Transportation (Type 3)',
    hint:
      'ტიპი 3 ზედნადებისთვის დატოვეთ მისამართები, მძღოლი და ავტომობილი ცარიელი და მიუთითეთ transportTypeId=0. ' +
      'For Type 3 Waybills, omit addresses/driver/vehicle and set transportTypeId=0.',
  },
  [-1037]: {
    fallbackGeorgianText:
      'სხვა ტრანსპორტირების ტიპისთვის (TRANS_ID=4) საჭიროა ტექსტური აღწერა',
    englishText:
      'Custom Transport Type text (TRANS_TXT) is required when TRANS_ID is 4 (Other)',
    hint:
      'მიუთითეთ ტრანსპორტირების ტიპის აღწერა (transportText), როცა ტრანსპორტირების ტიპი არის 4 (სხვა). ' +
      'Provide transportText when Transport Type is 4 (Other).',
  },
  [-2001]: {
    fallbackGeorgianText: 'საქონლის დასახელება ცარიელია',
    englishText: 'Line Item name is empty',
    hint:
      'მიუთითეთ საქონლის დასახელება ყველა პოზიციისთვის. ' +
      'Provide a non-empty goods name for every Line Item.',
  },
  [-2002]: {
    fallbackGeorgianText: 'ზომის ერთეულის ID არასწორია',
    englishText: 'Invalid measurement unit ID',
    hint:
      'იხილეთ ზომის ერთეულები rsge://reference/units რესურსში ან get_reference_data(category="units") ინსტრუმენტით. ' +
      'Consult valid measurement units via rsge://reference/units or get_reference_data(category="units").',
  },
  [-2003]: {
    fallbackGeorgianText: 'საქონლის რაოდენობა ან ფასი არასწორია',
    englishText: 'Invalid Line Item quantity or unit price',
    hint:
      'მიუთითეთ დადებითი რიცხვები წერტილის (.) გამყოფით. ' +
      'Provide positive numeric values using a dot (.) decimal separator.',
  },
  [-2004]: {
    fallbackGeorgianText: 'მიუთითეთ ზომის ერთეულის დასახელება (UNIT_ID=99)',
    englishText:
      'Custom measurement unit text (UNIT_TXT) is required when UNIT_ID is 99 (Other)',
    hint:
      'როცა ზომის ერთეულის ID არის 99 (სხვა), აუცილებელია unitText ველის შევსება. ' +
      'Provide unitText whenever measurement unit ID is 99 (Other).',
  },
  [-2005]: {
    fallbackGeorgianText: 'საქონლის პოზიციის თანხა არ ემთხვევა გამოთვლილ ჯამს',
    englishText: 'Line Item amount does not match quantity * unit price',
    hint:
      'დარწმუნდით, რომ რაოდენობა და ერთეულის ფასი სწორად არის მითითებული. ' +
      'Verify quantity and unit price values.',
  },
  [-2006]: {
    fallbackGeorgianText: 'საქონლის პოზიციის სტატუსი არასწორია',
    englishText: 'Invalid Line Item status (must be 1 for active items)',
    hint:
      'აქტიური საქონლის პოზიციის სტატუსი უნდა იყოს 1. ' +
      'Active Line Items must use status 1.',
  },
  [-2007]: {
    fallbackGeorgianText: 'დღგ-ის ტიპი არასწორია',
    englishText: 'Invalid VAT type (expected 0=standard, 1=zero-rated, 2=exempt)',
    hint:
      'გამოიყენეთ დღგ-ის ტიპი: 0 (ჩვეულებრივი 18%), 1 (ნულოვანი) ან 2 (დაუბეგრავი). ' +
      'Use VAT type 0 (standard 18%), 1 (zero-rated), or 2 (VAT-exempt).',
  },
  [-3001]: {
    fallbackGeorgianText:
      'ანგარიშ-ფაქტურის გამოწერა ამ ზედნადებზე შეუძლებელია ან უკვე გამოწერილია',
    englishText:
      'Tax Invoice cannot be created for this Waybill or already exists',
    hint:
      'დარწმუნდით, რომ ზედნადები გააქტიურებულია ან დასრულებულია და მასზე ანგარიშ-ფაქტურა ჯერ არ არის გამოწერილი. ' +
      'Verify the Waybill is Active or Completed and does not already have a linked Tax Invoice.',
  },
  [-3002]: {
    fallbackGeorgianText: 'გადასახადის გადამხდელი არ არის დღგ-ის გადამხდელი',
    englishText: 'Seller is not registered as a VAT payer',
    hint:
      'ანგარიშ-ფაქტურის გამოწერა შესაძლებელია მხოლოდ დღგ-ის გადამხდელის მიერ (შეგიძლიათ შეამოწმოთ lookup_taxpayer-ით). ' +
      'Only VAT-registered Sellers can issue a Tax Invoice (check status via lookup_taxpayer).',
  },
};

export interface TranslatedRsgeError {
  readonly code: number;
  readonly operation: string;
  readonly georgianText: string;
  readonly englishText: string;
  readonly hint: string;
  readonly errorType?: number;
  readonly knownCode: boolean;
}

export class RsgeApiError extends Error {
  readonly code: number;
  readonly operation: string;
  readonly georgianText: string;
  readonly englishText: string;
  readonly hint: string;
  readonly errorType?: number;
  readonly knownCode: boolean;
  readonly rawResult?: unknown;

  constructor(
    translated: TranslatedRsgeError,
    options?: { rawResult?: unknown; cause?: unknown },
  ) {
    super(
      `RS.ge შეცდომა ${translated.code} (${translated.operation}): ${translated.georgianText} | ` +
        `RS.ge error ${translated.code}: ${translated.englishText}. ${translated.hint}`,
      options?.cause ? { cause: options.cause } : undefined,
    );
    this.name = 'RsgeApiError';
    this.code = translated.code;
    this.operation = translated.operation;
    this.georgianText = translated.georgianText;
    this.englishText = translated.englishText;
    this.hint = translated.hint;
    this.errorType = translated.errorType;
    this.knownCode = translated.knownCode;
    this.rawResult = options?.rawResult;
  }
}

export function getKnownEnglishErrorText(code: number): string | undefined {
  return KNOWN_RSGE_ERRORS[code]?.englishText;
}

export function translateRsgeErrorCode(
  code: number,
  operation: string,
  catalog?: readonly RsgeErrorCodeItem[],
): TranslatedRsgeError {
  const catalogEntry = catalog?.find((entry) => entry.code === code);
  const knownMeta = KNOWN_RSGE_ERRORS[code];
  const officialGeorgian =
    catalogEntry && catalogEntry.text.trim().length > 0
      ? catalogEntry.text.trim()
      : undefined;

  if (knownMeta !== undefined) {
    return {
      code,
      operation,
      georgianText: officialGeorgian ?? knownMeta.fallbackGeorgianText,
      englishText: knownMeta.englishText,
      hint: knownMeta.hint,
      ...(catalogEntry !== undefined ? { errorType: catalogEntry.type } : {}),
      knownCode: true,
    };
  }

  if (catalogEntry !== undefined && officialGeorgian !== undefined) {
    const typeLabel = ERROR_TYPE_LABELS[catalogEntry.type];
    const isAuthText =
      /IP|ავტორიზ|მომხმარებლ|პაროლ/i.test(officialGeorgian);
    return {
      code,
      operation,
      georgianText: officialGeorgian,
      englishText: typeLabel
        ? `RS.ge error ${code} (${typeLabel}; see official Georgian message)`
        : `RS.ge error ${code} (see official Georgian message)`,
      hint: isAuthText ? IP_ALLOWLIST_AND_CREDS_HINT : DEFAULT_CHECK_PARAMS_HINT,
      errorType: catalogEntry.type,
      knownCode: true,
    };
  }

  return {
    code,
    operation,
    georgianText: `უცნობი RS.ge შეცდომის კოდი (${code})`,
    englishText: `Unknown RS.ge error code (${code})`,
    hint: DEFAULT_CHECK_PARAMS_HINT,
    knownCode: false,
  };
}
