import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

export const SOAP_NAMESPACE = 'http://tempuri.org/';

export type SoapParamValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | { readonly rawXml: string }
  | { readonly nil: true };

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function serializeSoapParams(
  params: Record<string, SoapParamValue>,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }
    if (value === null || (typeof value === 'object' && 'nil' in value)) {
      parts.push(`<${key} xsi:nil="true" />`);
      continue;
    }
    if (typeof value === 'object' && 'rawXml' in value) {
      parts.push(`<${key}>${value.rawXml}</${key}>`);
      continue;
    }
    parts.push(`<${key}>${escapeXml(String(value))}</${key}>`);
  }

  return parts.join('');
}

export function buildSoapEnvelope(operation: string, paramsXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<${operation} xmlns="${SOAP_NAMESPACE}">${paramsXml}</${operation}>` +
    `</soap:Body>` +
    `</soap:Envelope>`
  );
}

export function parseSoapXml(xml: string): unknown {
  return xmlParser.parse(xml);
}

export function toArray<T>(value: T | T[] | '' | null | undefined): T[] {
  if (value === null || value === undefined || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export const xmlBooleanSchema = z
  .union([z.boolean(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
    ctx.addIssue({
      code: 'custom',
      message: `Expected XML boolean, received "${value}"`,
    });
    return z.NEVER;
  });

export const xmlIntSchema = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    const parsed = Number.parseInt(String(value).trim(), 10);
    if (!Number.isInteger(parsed) || String(parsed) !== String(value).trim()) {
      ctx.addIssue({
        code: 'custom',
        message: `Expected XML integer, received "${String(value)}"`,
      });
      return z.NEVER;
    }
    return parsed;
  });

export function createIntResultResponseSchema<TOp extends string>(
  operation: TOp,
): z.ZodType<number>;
export function createIntResultResponseSchema<
  TOp extends string,
  TExtra extends z.ZodRawShape,
>(
  operation: TOp,
  extraFields: TExtra,
): z.ZodType<
  { readonly [K in `${TOp}Result`]: number } & z.output<z.ZodObject<TExtra>>
>;
export function createIntResultResponseSchema<
  TOp extends string,
  TExtra extends z.ZodRawShape,
>(operation: TOp, extraFields?: TExtra): z.ZodType<unknown> {
  const resultKey = `${operation}Result` as const;
  if (extraFields !== undefined) {
    return z.object({
      [resultKey]: xmlIntSchema,
      ...extraFields,
    });
  }
  return z
    .object({
      [resultKey]: xmlIntSchema,
    })
    .transform((record) => record[resultKey] as number);
}

export function createBooleanResultResponseSchema<TOp extends string>(
  operation: TOp,
): z.ZodType<boolean> {
  const resultKey = `${operation}Result` as const;
  return z
    .object({
      [resultKey]: xmlBooleanSchema,
    })
    .transform((record) => record[resultKey] as boolean);
}
