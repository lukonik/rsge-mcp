import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { createRsgeServer } from '../src/server.js';
import { createSoapClient } from '../src/soap/index.js';
import {
  errorCodesXml,
  rsgeResultStatusErrorXml,
  scalarOperationResultXml,
  waybillUnitsXml,
  xmlResponse,
} from './fixtures/soap.js';

function createTestConfig(
  user = 'demo_user:206322102',
  pass = 'demo-secret-password',
) {
  return loadConfig({
    RSGE_SERVICE_USER: user,
    RSGE_SERVICE_PASSWORD: pass,
  });
}

describe('Automatic lazy RS.ge error-code translation', () => {
  it('lazily fetches and caches get_error_codes on negative RESULT.STATUS and reuses the cache for resources and later errors', async () => {
    const callsByAction = new Map<string, number>();
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      callsByAction.set(soapAction, (callsByAction.get(soapAction) ?? 0) + 1);

      if (soapAction === '"http://tempuri.org/get_waybill_types"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_waybill_types', -1001));
      }
      if (soapAction === '"http://tempuri.org/get_waybill_units"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_waybill_units', -2004));
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(errorCodesXml());
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const firstResult = await client.callToolRaw('get_reference_data', {
        category: 'waybill_types',
      });

      expect(firstResult.isError).toBe(true);
      const firstPayload = JSON.parse(
        firstResult.content[0]?.type === 'text' ? firstResult.content[0].text : '{}',
      ) as Record<string, unknown>;

      expect(firstPayload.error).toBe('RSGE_API_ERROR');
      expect(firstPayload.code).toBe(-1001);
      expect(firstPayload.operation).toBe('get_waybill_types');
      expect(firstPayload.errorType).toBe(1);
      expect(firstPayload.georgianText).toBe('ზედნადების ტიპი არასწორია');
      expect(String(firstPayload.englishText)).toMatch(/Waybill Type/i);
      expect(String(firstPayload.hint)).toMatch(/[ა-ჰ]/);
      expect(String(firstPayload.hint)).toMatch(/[A-Za-z]{4,}/);
      expect(firstPayload.knownCode).toBe(true);

      // Second negative error must reuse the already-cached error codes (no extra get_error_codes fetch)
      const secondResult = await client.callToolRaw('get_reference_data', {
        category: 'units',
      });
      expect(secondResult.isError).toBe(true);
      const secondPayload = JSON.parse(
        secondResult.content[0]?.type === 'text'
          ? secondResult.content[0].text
          : '{}',
      ) as Record<string, unknown>;
      expect(secondPayload.error).toBe('RSGE_API_ERROR');
      expect(secondPayload.code).toBe(-2004);
      expect(secondPayload.georgianText).toBe(
        'მიუთითეთ ზომის ერთეულის დასახელება',
      );
      expect(String(secondPayload.englishText)).toMatch(/UNIT_TXT|unit/i);

      // Reading rsge://reference/error-codes must also reuse the same session cache
      const resourceContents = await client.readResource(
        'rsge://reference/error-codes',
      );
      const resourcePayload = JSON.parse(
        'text' in resourceContents[0]! ? resourceContents[0]!.text : '{}',
      ) as { count: number };
      expect(resourcePayload.count).toBe(4);

      expect(callsByAction.get('"http://tempuri.org/get_error_codes"')).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('includes Georgian and English IP-allowlisting guidance on -100 auth errors without infinite recursion when get_error_codes also rejects', async () => {
    const callsByAction = new Map<string, number>();
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      callsByAction.set(soapAction, (callsByAction.get(soapAction) ?? 0) + 1);

      if (soapAction === '"http://tempuri.org/get_waybill_types"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_waybill_types', -100));
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_error_codes', -100));
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig('secret_user:206322102', 'secret-pass-999'),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_reference_data', {
        category: 'waybill_types',
      });

      expect(result.isError).toBe(true);
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-100);
      expect(String(payload.georgianText)).toMatch(/[ა-ჰ]/);
      expect(String(payload.englishText)).toMatch(/credentials|IP/i);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      expect(String(payload.hint)).toMatch(/IP/i);
      expect(String(payload.hint)).toMatch(/RS\.ge/i);
      expect(rawText).not.toContain('secret_user:206322102');
      expect(rawText).not.toContain('secret-pass-999');

      // Strictly 1 call to get_waybill_types and 1 call to get_error_codes (zero recursion!)
      expect(callsByAction.get('"http://tempuri.org/get_waybill_types"')).toBe(
        1,
      );
      expect(callsByAction.get('"http://tempuri.org/get_error_codes"')).toBe(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('does not recurse or poison cache when get_error_codes itself fails directly', async () => {
    let attempt = 0;
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        attempt += 1;
        if (attempt === 1) {
          return xmlResponse(rsgeResultStatusErrorXml('get_error_codes', -100));
        }
        return xmlResponse(errorCodesXml());
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const failed = await client.callToolRaw('get_reference_data', {
        category: 'error_codes',
      });
      expect(failed.isError).toBe(true);
      const failedPayload = JSON.parse(
        failed.content[0]?.type === 'text' ? failed.content[0].text : '{}',
      ) as Record<string, unknown>;
      expect(failedPayload.error).toBe('RSGE_API_ERROR');
      expect(failedPayload.code).toBe(-100);
      expect(String(failedPayload.hint)).toMatch(/IP/i);
      expect(fakeFetch).toHaveBeenCalledTimes(1);

      // Next attempt retries instead of reusing failure
      const recovered = await client.callToolRaw('get_reference_data', {
        category: 'error_codes',
      });
      expect(recovered.isError).toBeFalsy();
      expect(fakeFetch).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('gracefully handles unknown RS.ge error codes both inside and outside get_error_codes', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_waybill_types"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_waybill_types', -8888));
      }
      if (soapAction === '"http://tempuri.org/get_trans_types"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_trans_types', -9999));
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(
          errorCodesXml([
            {
              id: -8888,
              text: 'სპეციფიკური RS.ge შეცდომა',
              type: 1,
            },
          ]),
        );
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      // -8888 is in RS.ge get_error_codes, without a static English dictionary entry
      const catalogOnly = await client.callToolRaw('get_reference_data', {
        category: 'waybill_types',
      });
      expect(catalogOnly.isError).toBe(true);
      const catalogPayload = JSON.parse(
        catalogOnly.content[0]?.type === 'text'
          ? catalogOnly.content[0].text
          : '{}',
      ) as Record<string, unknown>;
      expect(catalogPayload.error).toBe('RSGE_API_ERROR');
      expect(catalogPayload.code).toBe(-8888);
      expect(catalogPayload.georgianText).toBe('სპეციფიკური RS.ge შეცდომა');
      expect(String(catalogPayload.englishText)).toContain('-8888');
      expect(catalogPayload.knownCode).toBe(true);
      expect(String(catalogPayload.hint)).toMatch(/[ა-ჰ]/);

      // -9999 is completely unknown (not in get_error_codes, not in static dictionary)
      const completelyUnknown = await client.callToolRaw('get_reference_data', {
        category: 'transport_types',
      });
      expect(completelyUnknown.isError).toBe(true);
      const unknownPayload = JSON.parse(
        completelyUnknown.content[0]?.type === 'text'
          ? completelyUnknown.content[0].text
          : '{}',
      ) as Record<string, unknown>;
      expect(unknownPayload.error).toBe('RSGE_API_ERROR');
      expect(unknownPayload.code).toBe(-9999);
      expect(String(unknownPayload.georgianText)).toContain('-9999');
      expect(String(unknownPayload.englishText)).toContain('-9999');
      expect(unknownPayload.knownCode).toBe(false);
      expect(String(unknownPayload.hint)).toContain(
        'rsge://reference/error-codes',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('surfaces translated Georgian + English errors on Resource read failures without caching the failure', async () => {
    let unitsAttempt = 0;
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_waybill_units"') {
        unitsAttempt += 1;
        if (unitsAttempt === 1) {
          return xmlResponse(rsgeResultStatusErrorXml('get_waybill_units', -100));
        }
        return xmlResponse(waybillUnitsXml());
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(errorCodesXml());
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(
        client.readResource('rsge://reference/units'),
      ).rejects.toThrow(/-100.*IP/s);

      // Subsequent read retries and succeeds
      const contents = await client.readResource('rsge://reference/units');
      const payload = JSON.parse(
        'text' in contents[0]! ? contents[0]!.text : '{}',
      ) as { count: number };
      expect(payload.count).toBe(3);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('translates scalar negative integer SOAP responses (e.g. close_waybill, send_waybill) into RsgeApiError', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/close_waybill"') {
        return xmlResponse(scalarOperationResultXml('close_waybill', -101));
      }
      if (soapAction === '"http://tempuri.org/send_waybill"') {
        return xmlResponse(scalarOperationResultXml('send_waybill', '-100'));
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(errorCodesXml());
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const config = createTestConfig();
    const logger = createLogger({
      secrets: [config.serviceUser, config.servicePassword],
      level: 'silent',
    });
    const soapClient = createSoapClient({ config, logger, fetch: fakeFetch });

    await expect(
      soapClient.callOperation(
        'close_waybill',
        { waybill_id: 123 },
        z.object({ close_waybillResult: z.string() }),
      ),
    ).rejects.toMatchObject({
      name: 'RsgeApiError',
      code: -101,
      operation: 'close_waybill',
      georgianText: 'ზედნადები არ ეკუთვნის გადამხდელს',
    });

    await expect(
      soapClient.callOperation(
        'send_waybill',
        { waybill_id: 123 },
        z.object({ send_waybillResult: z.string() }),
      ),
    ).rejects.toMatchObject({
      name: 'RsgeApiError',
      code: -100,
      operation: 'send_waybill',
    });
  });
});
