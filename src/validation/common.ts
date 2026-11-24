import { z } from 'zod';

export const GEORGIAN_TIN_PATTERN = /^(?:\d{9}|\d{11})$/;
export const GEORGIAN_DRIVER_TIN_PATTERN = /^\d{11}$/;

export const TIN_VALIDATION_MESSAGE =
  'საიდენტიფიკაციო კოდი (TIN) უნდა იყოს 9-ნიშნა (იურიდიული პირი) ან 11-ნიშნა (ფიზიკური პირი) ციფრული სტრიქონი. ' +
  'TIN must be a 9-digit (legal entity) or 11-digit (individual) numeric string.';

export const georgianTinSchema = z
  .string({ error: TIN_VALIDATION_MESSAGE })
  .regex(GEORGIAN_TIN_PATTERN, { error: TIN_VALIDATION_MESSAGE });

export const trimmedGeorgianTinSchema = z
  .string({ error: TIN_VALIDATION_MESSAGE })
  .trim()
  .regex(GEORGIAN_TIN_PATTERN, { error: TIN_VALIDATION_MESSAGE });

export const waybillIdSchema = z
  .number()
  .int(
    'ზედნადების ID (waybill_id) უნდა იყოს მთელი რიცხვი. waybill_id must be an integer.',
  )
  .positive(
    'ზედნადების ID (waybill_id) უნდა იყოს დადებითი მთელი რიცხვი. waybill_id must be a positive integer.',
  );

export const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_LOCAL_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const ISO_DATE_OR_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?$/;

const ISO_DATE_PARTS_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

export function isValidIsoDateOrDateTime(value: string): boolean {
  const match = ISO_DATE_PARTS_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function normalizeDateBound(
  value: string,
  bound: 'start' | 'end',
): string {
  const trimmed = value.trim();
  if (ISO_DATE_ONLY_PATTERN.test(trimmed)) {
    return bound === 'start' ? `${trimmed}T00:00:00` : `${trimmed}T23:59:59`;
  }
  return trimmed;
}

export const isoDateOrDateTimeSchema = z
  .string()
  .trim()
  .regex(
    ISO_DATE_OR_DATETIME_PATTERN,
    'თარიღის ფორმატი უნდა იყოს YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss. ' +
      'Date must be formatted as YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss.',
  )
  .refine(
    isValidIsoDateOrDateTime,
    'მიუთითეთ ვალიდური კალენდარული თარიღი/დრო (YYYY-MM-DD ან YYYY-MM-DDTHH:mm:ss). ' +
      'Provide a valid calendar date/time (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss).',
  );

export function createIsoLocalDateTimeSchema(fieldName: string) {
  return z
    .string()
    .trim()
    .regex(
      ISO_LOCAL_DATETIME_PATTERN,
      `${fieldName} უნდა იყოს yyyy-MM-ddTHH:mm:ss ფორმატში / ${fieldName} must match yyyy-MM-ddTHH:mm:ss`,
    )
    .refine(
      isValidIsoDateOrDateTime,
      `${fieldName} უნდა იყოს ვალიდური კალენდარული თარიღი და დრო (yyyy-MM-ddTHH:mm:ss) / ${fieldName} must be a valid calendar date and time (yyyy-MM-ddTHH:mm:ss)`,
    );
}
