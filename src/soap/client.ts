import { z } from 'zod';
import type { RsgeConfig } from '../config.js';
import type { RsgeLogger } from '../logger.js';
import {
  RsgeApiError,
  TRANSPORT_TYPE_ENGLISH_NAMES,
  WAYBILL_TYPE_ENGLISH_NAMES,
  getKnownEnglishErrorText,
  translateRsgeErrorCode,
  type RsgeErrorCodeItem,
  type TransportTypeItem,
  type WaybillTypeItem,
  type WaybillUnitItem,
} from '../reference/index.js';
import {
  SOAP_NAMESPACE,
  buildSoapEnvelope,
  parseSoapXml,
  serializeSoapParams,
  toArray,
  xmlBooleanSchema,
  xmlIntSchema,
  type SoapParamValue,
} from './xml.js';

export class SoapTransportError extends Error {
  readonly statusCode?: number;

  constructor(message: string, options?: { statusCode?: number; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'SoapTransportError';
    this.statusCode = options?.statusCode;
  }
}

export class SoapFaultError extends Error {
  readonly faultCode: string;
  readonly faultString: string;

  constructor(faultCode: string, faultString: string) {
    super(`SOAP Fault (${faultCode}): ${faultString}`);
    this.name = 'SoapFaultError';
    this.faultCode = faultCode;
    this.faultString = faultString;
  }
}

export class SoapParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SoapParseError';
  }
}

export interface CheckServiceUserResult {
  readonly valid: boolean;
  readonly unId: number;
  readonly serviceUserId: number;
}

const soapEnvelopeSchema = z.object({
  Envelope: z.object({
    Body: z.record(z.string(), z.unknown()),
  }),
});

const soapFaultSchema = z.object({
  faultcode: z.string().optional().default('soap:Server'),
  faultstring: z.string().optional().default('Unknown SOAP fault'),
});

const checkServiceUserResponseSchema = z.object({
  chek_service_userResult: xmlBooleanSchema,
  un_id: xmlIntSchema,
  s_user_id: xmlIntSchema,
});

const idNameItemSchema = z.object({
  ID: xmlIntSchema,
  NAME: z.union([z.string(), z.number()]).transform((value) => String(value)),
});

const errorCodeXmlItemSchema = z.object({
  ID: xmlIntSchema,
  TEXT: z
    .union([z.string(), z.number()])
    .optional()
    .default('')
    .transform((value) => String(value)),
  TYPE: z
    .union([xmlIntSchema, z.literal('')])
    .optional()
    .transform((value) => (typeof value === 'number' ? value : 0)),
});

function xmlContainerSchema<T>(
  containerTag: string,
  itemTag: string,
  itemSchema: z.ZodType<T>,
) {
  return z
    .object({
      [containerTag]: z.union([
        z.literal(''),
        z.null(),
        z.undefined(),
        z.object({
          [itemTag]: z.union([itemSchema, z.array(itemSchema)]).optional(),
        }),
      ]),
    })
    .transform((result): T[] => {
      const container = result[containerTag];
      if (!container || typeof container !== 'object') {
        return [];
      }
      return toArray(container[itemTag] as T | T[] | undefined);
    });
}

const getWaybillTypesResponseSchema = z.object({
  get_waybill_typesResult: xmlContainerSchema(
    'WAYBILL_TYPES',
    'WAYBILL_TYPE',
    idNameItemSchema,
  ),
});

const getWaybillUnitsResponseSchema = z.object({
  get_waybill_unitsResult: xmlContainerSchema(
    'WAYBILL_UNITS',
    'WAYBILL_UNIT',
    idNameItemSchema,
  ),
});

const getTransTypesResponseSchema = z.object({
  get_trans_typesResult: xmlContainerSchema(
    'TRANSPORT_TYPES',
    'TRANSPORT_TYPE',
    idNameItemSchema,
  ),
});

const getErrorCodesResponseSchema = z.object({
  get_error_codesResult: z
    .union([
      xmlContainerSchema('ERROR_CODES', 'ERROR_CODE', errorCodeXmlItemSchema),
      xmlContainerSchema('WAYBILL_TYPES', 'WAYBILL_TYPE', errorCodeXmlItemSchema),
    ]),
});

export interface CreateSoapClientOptions {
  readonly config: RsgeConfig;
  readonly logger: RsgeLogger;
  readonly fetch?: typeof globalThis.fetch;
  readonly getErrorCodesForTranslation?: () => Promise<readonly RsgeErrorCodeItem[]>;
}

export interface RsgeSoapClient {
  callOperation<T>(
    operation: string,
    params: Record<string, SoapParamValue>,
    responseSchema: z.ZodType<T>,
  ): Promise<T>;
  translateErrorCode(
    code: number,
    operation: string,
    rawResult?: unknown,
  ): Promise<RsgeApiError>;
  checkServiceUser(): Promise<CheckServiceUserResult>;
  getWaybillTypes(): Promise<WaybillTypeItem[]>;
  getWaybillUnits(): Promise<WaybillUnitItem[]>;
  getTransportTypes(): Promise<TransportTypeItem[]>;
  getErrorCodes(): Promise<RsgeErrorCodeItem[]>;
}

const NEGATIVE_INT_PATTERN = /^-\d+$/;

function extractNegativeInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value < 0 ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (NEGATIVE_INT_PATTERN.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isInteger(parsed) && parsed < 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function detectRsgeErrorCode(
  operation: string,
  operationResponse: unknown,
): { readonly code: number; readonly rawResult: unknown } | undefined {
  if (
    operationResponse === null ||
    typeof operationResponse !== 'object' ||
    Array.isArray(operationResponse)
  ) {
    return undefined;
  }

  const record = operationResponse as Record<string, unknown>;
  const resultValue = record[`${operation}Result`];

  const scalarCode = extractNegativeInteger(resultValue);
  if (scalarCode !== undefined) {
    return { code: scalarCode, rawResult: resultValue };
  }

  if (
    resultValue !== null &&
    typeof resultValue === 'object' &&
    !Array.isArray(resultValue)
  ) {
    const resultNode = (resultValue as Record<string, unknown>).RESULT;
    if (
      resultNode !== null &&
      typeof resultNode === 'object' &&
      !Array.isArray(resultNode)
    ) {
      const statusCode = extractNegativeInteger(
        (resultNode as Record<string, unknown>).STATUS,
      );
      if (statusCode !== undefined) {
        return { code: statusCode, rawResult: resultValue };
      }
    }
  }

  return undefined;
}

export function createSoapClient(options: CreateSoapClientOptions): RsgeSoapClient {
  const { config, logger } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;

  function createHttpStatusError(
    operation: string,
    status: number,
    logMessage: string,
    cause?: unknown,
  ): SoapTransportError {
    logger.error(logMessage, { operation, status });
    return new SoapTransportError(
      `RS.ge სერვისმა დააბრუნა HTTP ${status} შეცდომა (${operation}). ` +
        `RS.ge WayBillService returned HTTP ${status} (${operation}).`,
      { statusCode: status, ...(cause !== undefined ? { cause } : {}) },
    );
  }

  async function resolveErrorCodesCatalog(): Promise<
    readonly RsgeErrorCodeItem[] | undefined
  > {
    if (!options.getErrorCodesForTranslation) {
      return undefined;
    }

    try {
      return await options.getErrorCodesForTranslation();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to lazily load RS.ge error codes for translation', {
        error: logger.redact(rawMessage),
      });
      return undefined;
    }
  }

  async function translateErrorCode(
    code: number,
    operation: string,
    rawResult?: unknown,
  ): Promise<RsgeApiError> {
    const catalog =
      operation === 'get_error_codes'
        ? undefined
        : await resolveErrorCodesCatalog();

    const translated = translateRsgeErrorCode(code, operation, catalog);
    const safeTranslated = {
      ...translated,
      georgianText: logger.redact(translated.georgianText),
      englishText: logger.redact(translated.englishText),
      hint: logger.redact(translated.hint),
    };

    logger.warn('RS.ge returned negative error code', {
      operation,
      code,
      knownCode: safeTranslated.knownCode,
    });

    return new RsgeApiError(safeTranslated, { rawResult });
  }

  async function callOperation<T>(
    operation: string,
    params: Record<string, SoapParamValue>,
    responseSchema: z.ZodType<T>,
  ): Promise<T> {
    const paramsXml = serializeSoapParams({
      su: config.serviceUser,
      sp: config.servicePassword,
      ...params,
    });
    const envelopeXml = buildSoapEnvelope(operation, paramsXml);
    const soapAction = `"${SOAP_NAMESPACE}${operation}"`;

    logger.debug('Sending RS.ge SOAP request', {
      operation,
      endpoint: config.endpoint,
    });

    let response: Response;
    try {
      response = await fetchFn(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapAction,
        },
        body: envelopeXml,
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const safeMessage = logger.redact(rawMessage);
      logger.error('RS.ge SOAP network request failed', {
        operation,
        endpoint: config.endpoint,
        error: safeMessage,
      });
      throw new SoapTransportError(
        `RS.ge სერვისთან დაკავშირება ვერ მოხერხდა (${operation}): ${safeMessage}. ` +
          `Failed to reach RS.ge WayBillService (${operation}): ${safeMessage}.`,
        { cause: error },
      );
    }

    const responseText = await response.text();
    let parsedXml: unknown;
    try {
      parsedXml = parseSoapXml(responseText);
    } catch (error) {
      if (!response.ok) {
        throw createHttpStatusError(
          operation,
          response.status,
          'RS.ge SOAP HTTP error with non-XML body',
          error,
        );
      }
      throw new SoapParseError(
        `RS.ge XML პასუხის დამუშავება ვერ მოხერხდა (${operation}). ` +
          `Failed to parse RS.ge XML response (${operation}).`,
        error,
      );
    }

    const envelopeResult = soapEnvelopeSchema.safeParse(parsedXml);
    if (!envelopeResult.success) {
      if (!response.ok) {
        throw createHttpStatusError(
          operation,
          response.status,
          'RS.ge SOAP HTTP error without SOAP Envelope',
        );
      }
      throw new SoapParseError(
        `RS.ge პასუხში SOAP Envelope ვერ მოიძებნა (${operation}). ` +
          `Missing SOAP Envelope in RS.ge response (${operation}).`,
      );
    }

    const body = envelopeResult.data.Envelope.Body;
    if ('Fault' in body && body.Fault !== undefined) {
      const faultParsed = soapFaultSchema.safeParse(body.Fault);
      const faultCode = logger.redact(
        faultParsed.success ? faultParsed.data.faultcode : 'soap:Server',
      );
      const faultString = logger.redact(
        faultParsed.success ? faultParsed.data.faultstring : 'Unknown SOAP fault',
      );
      logger.error('RS.ge returned SOAP Fault', {
        operation,
        status: response.status,
        faultCode,
        faultString,
      });
      throw new SoapFaultError(faultCode, faultString);
    }

    if (!response.ok) {
      throw createHttpStatusError(
        operation,
        response.status,
        'RS.ge returned non-2xx HTTP status',
      );
    }

    const responseElementName = `${operation}Response`;
    const operationResponse = body[responseElementName];
    if (operationResponse === undefined) {
      throw new SoapParseError(
        `RS.ge პასუხში ელემენტი <${responseElementName}> ვერ მოიძებნა. ` +
          `Missing <${responseElementName}> in RS.ge SOAP response.`,
      );
    }

    const detectedError = detectRsgeErrorCode(operation, operationResponse);
    if (detectedError !== undefined) {
      throw await translateErrorCode(
        detectedError.code,
        operation,
        detectedError.rawResult,
      );
    }

    const validated = responseSchema.safeParse(operationResponse);
    if (!validated.success) {
      logger.error('RS.ge SOAP response failed schema validation', {
        operation,
        issues: validated.error.issues.map((i) => i.message),
      });
      throw new SoapParseError(
        `RS.ge პასუხის სტრუქტურა არ შეესაბამება მოსალოდნელ ფორმატს (${operation}). ` +
          `RS.ge SOAP response did not match expected schema (${operation}).`,
        validated.error,
      );
    }

    return validated.data;
  }

  async function checkServiceUser(): Promise<CheckServiceUserResult> {
    const parsed = await callOperation(
      'chek_service_user',
      {},
      checkServiceUserResponseSchema,
    );

    return {
      valid: parsed.chek_service_userResult,
      unId: parsed.un_id,
      serviceUserId: parsed.s_user_id,
    };
  }

  async function getWaybillTypes(): Promise<WaybillTypeItem[]> {
    const parsed = await callOperation(
      'get_waybill_types',
      {},
      getWaybillTypesResponseSchema,
    );

    return parsed.get_waybill_typesResult.map((item) => {
      const englishName = WAYBILL_TYPE_ENGLISH_NAMES[item.ID];
      return {
        id: item.ID,
        name: item.NAME,
        ...(englishName !== undefined ? { englishName } : {}),
      };
    });
  }

  async function getWaybillUnits(): Promise<WaybillUnitItem[]> {
    const parsed = await callOperation(
      'get_waybill_units',
      {},
      getWaybillUnitsResponseSchema,
    );

    return parsed.get_waybill_unitsResult.map((item) => ({
      id: item.ID,
      name: item.NAME,
    }));
  }

  async function getTransportTypes(): Promise<TransportTypeItem[]> {
    const parsed = await callOperation(
      'get_trans_types',
      {},
      getTransTypesResponseSchema,
    );

    return parsed.get_trans_typesResult.map((item) => {
      const englishName = TRANSPORT_TYPE_ENGLISH_NAMES[item.ID];
      return {
        id: item.ID,
        name: item.NAME,
        ...(englishName !== undefined ? { englishName } : {}),
      };
    });
  }

  async function getErrorCodes(): Promise<RsgeErrorCodeItem[]> {
    const parsed = await callOperation(
      'get_error_codes',
      {},
      getErrorCodesResponseSchema,
    );

    return parsed.get_error_codesResult.map((item) => {
      const englishText = getKnownEnglishErrorText(item.ID);
      return {
        code: item.ID,
        text: item.TEXT,
        type: item.TYPE,
        ...(englishText !== undefined ? { englishText } : {}),
      };
    });
  }

  return {
    callOperation,
    translateErrorCode,
    checkServiceUser,
    getWaybillTypes,
    getWaybillUnits,
    getTransportTypes,
    getErrorCodes,
  };
}
