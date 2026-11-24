import { z } from 'zod';
import type { RsgeConfig } from '../config.js';
import type { RsgeLogger } from '../logger.js';
import {
  SOAP_NAMESPACE,
  buildSoapEnvelope,
  parseSoapXml,
  serializeSoapParams,
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

export interface CreateSoapClientOptions {
  readonly config: RsgeConfig;
  readonly logger: RsgeLogger;
  readonly fetch?: typeof globalThis.fetch;
}

export interface RsgeSoapClient {
  callOperation<T>(
    operation: string,
    params: Record<string, SoapParamValue>,
    responseSchema: z.ZodType<T>,
  ): Promise<T>;
  checkServiceUser(): Promise<CheckServiceUserResult>;
}

export function createSoapClient(options: CreateSoapClientOptions): RsgeSoapClient {
  const { config, logger } = options;
  const fetchFn = options.fetch ?? globalThis.fetch;

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
        logger.error('RS.ge SOAP HTTP error with non-XML body', {
          operation,
          status: response.status,
        });
        throw new SoapTransportError(
          `RS.ge სერვისმა დააბრუნა HTTP ${response.status} შეცდომა (${operation}). ` +
            `RS.ge WayBillService returned HTTP ${response.status} (${operation}).`,
          { statusCode: response.status, cause: error },
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
        logger.error('RS.ge SOAP HTTP error without SOAP Envelope', {
          operation,
          status: response.status,
        });
        throw new SoapTransportError(
          `RS.ge სერვისმა დააბრუნა HTTP ${response.status} შეცდომა (${operation}). ` +
            `RS.ge WayBillService returned HTTP ${response.status} (${operation}).`,
          { statusCode: response.status },
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
      logger.error('RS.ge returned non-2xx HTTP status', {
        operation,
        status: response.status,
      });
      throw new SoapTransportError(
        `RS.ge სერვისმა დააბრუნა HTTP ${response.status} შეცდომა (${operation}). ` +
          `RS.ge WayBillService returned HTTP ${response.status} (${operation}).`,
        { statusCode: response.status },
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

  return {
    callOperation,
    checkServiceUser,
  };
}
