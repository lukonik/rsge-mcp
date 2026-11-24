import { ToolResult } from '@prefecthq/fastmcp-ts/server';
import type { RsgeLogger } from '../logger.js';
import {
  IP_ALLOWLIST_AND_CREDS_HINT,
  RsgeApiError,
} from '../reference/index.js';
import {
  SoapFaultError,
  SoapParseError,
  SoapTransportError,
} from '../soap/index.js';

export { IP_ALLOWLIST_AND_CREDS_HINT };

export const NETWORK_FAILURE_HINT =
  'გადაამოწმეთ ინტერნეტ კავშირი, RSGE_ENDPOINT მისამართი და ფაირვოლის/IP დაშვების პარამეტრები RS.ge-სთვის. ' +
  'Check network connectivity, the RSGE_ENDPOINT URL, and firewall/outbound IP settings for RS.ge.';

export function toolErrorResult(
  payload: Record<string, unknown>,
  logger: RsgeLogger,
): ToolResult {
  const safeJson = logger.redact(JSON.stringify(payload));
  return new ToolResult({
    isError: true,
    content: [{ type: 'text', text: safeJson }],
  });
}

export function formatSoapErrorResult(
  error: unknown,
  logger: RsgeLogger,
  extra: Record<string, unknown> = {},
): ToolResult {
  if (error instanceof RsgeApiError) {
    return toolErrorResult(
      {
        ...extra,
        error: 'RSGE_API_ERROR',
        code: error.code,
        operation: error.operation,
        ...(error.errorType !== undefined ? { errorType: error.errorType } : {}),
        georgianText: error.georgianText,
        englishText: error.englishText,
        message: `${error.georgianText} / ${error.englishText}`,
        hint: error.hint,
        knownCode: error.knownCode,
      },
      logger,
    );
  }

  if (error instanceof SoapFaultError) {
    return toolErrorResult(
      {
        ...extra,
        error: 'SOAP_FAULT',
        faultCode: error.faultCode,
        message:
          `RS.ge SOAP შეცდომა (${error.faultCode}): ${error.faultString}. ` +
          `RS.ge SOAP fault (${error.faultCode}): ${error.faultString}.`,
        hint: IP_ALLOWLIST_AND_CREDS_HINT,
      },
      logger,
    );
  }

  if (error instanceof SoapTransportError) {
    return toolErrorResult(
      {
        ...extra,
        error: 'NETWORK_ERROR',
        ...(error.statusCode !== undefined ? { statusCode: error.statusCode } : {}),
        message: error.message,
        hint: NETWORK_FAILURE_HINT,
      },
      logger,
    );
  }

  if (error instanceof SoapParseError) {
    return toolErrorResult(
      {
        ...extra,
        error: 'SOAP_PARSE_ERROR',
        message: error.message,
        hint: NETWORK_FAILURE_HINT,
      },
      logger,
    );
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  return toolErrorResult(
    {
      ...extra,
      error: 'INTERNAL_ERROR',
      message:
        `მოულოდნელი შეცდომა RS.ge მოთხოვნისას: ${rawMessage}. ` +
        `Unexpected error during RS.ge request: ${rawMessage}.`,
    },
    logger,
  );
}
