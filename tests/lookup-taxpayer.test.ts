import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, createRsgeServer } from '../src/index.js';
import { createTestConfig } from './fixtures/mcp.js';
import {
  errorCodesXml,
  rsgeResultStatusErrorXml,
  scalarOperationResultXml,
  soapEnvelope,
  xmlResponse,
} from './fixtures/soap.js';

function getNameFromTinXml(name: string): string {
  const resultTag =
    name.length === 0
      ? `<get_name_from_tinResult />`
      : `<get_name_from_tinResult>${name}</get_name_from_tinResult>`;
  return soapEnvelope(
    `<get_name_from_tinResponse xmlns="http://tempuri.org/">` +
      resultTag +
      `</get_name_from_tinResponse>`,
  );
}

function isVatPayerTinXml(isVatPayer: boolean): string {
  return soapEnvelope(
    `<is_vat_payer_tinResponse xmlns="http://tempuri.org/">` +
      `<is_vat_payer_tinResult>${isVatPayer ? 'true' : 'false'}</is_vat_payer_tinResult>` +
      `</is_vat_payer_tinResponse>`,
  );
}

describe('lookup_taxpayer tool via MCP protocol and stubbed fetch', () => {
  it('registers lookup_taxpayer with readOnlyHint and Georgian-primary / English-secondary description', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();
      const tool = tools.find((item) => item.name === 'lookup_taxpayer');

      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.annotations?.destructiveHint).toBe(false);
      expect(tool?.annotations?.idempotentHint).toBe(true);
      // Georgian primary (starts with Georgian) + English secondary
      expect(tool?.description).toMatch(/^[ა-ჰ]/);
      expect(tool?.description).toMatch(/[A-Za-z]{4,}/);

      const properties = (
        tool?.inputSchema as { properties?: Record<string, unknown> } | undefined
      )?.properties;
      expect(properties?.tin).toBeDefined();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('looks up a 9-digit legal entity TIN and returns Taxpayer name and VAT payer status', async () => {
    const capturedRequests: Array<{
      url: string;
      soapAction: string;
      contentType: string | null;
      body: string;
    }> = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      const headers = new Headers(init?.headers);
      const soapAction = headers.get('soapaction') ?? '';
      capturedRequests.push({
        url: String(input),
        soapAction,
        contentType: headers.get('content-type'),
        body: String(init?.body ?? ''),
      });

      if (soapAction === '"http://tempuri.org/get_name_from_tin"') {
        return xmlResponse(getNameFromTinXml('შპს მაგალითი'));
      }
      if (soapAction === '"http://tempuri.org/is_vat_payer_tin"') {
        return xmlResponse(isVatPayerTinXml(true));
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const config = createTestConfig('seller_user:206322102', 'secret-p&ss');
    const server = createRsgeServer({
      config,
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '206322102',
      });

      expect(result.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(2);

      const nameReq = capturedRequests.find(
        (req) => req.soapAction === '"http://tempuri.org/get_name_from_tin"',
      );
      const vatReq = capturedRequests.find(
        (req) => req.soapAction === '"http://tempuri.org/is_vat_payer_tin"',
      );

      expect(nameReq).toBeDefined();
      expect(vatReq).toBeDefined();
      for (const req of [nameReq!, vatReq!]) {
        expect(req.url).toBe(DEFAULT_RSGE_ENDPOINT);
        expect(req.contentType).toBe('text/xml; charset=utf-8');
        expect(req.body).toContain('<su>seller_user:206322102</su>');
        expect(req.body).toContain('<sp>secret-p&amp;ss</sp>');
        expect(req.body).toContain('<tin>206322102</tin>');
      }
      expect(nameReq!.body).toContain(
        '<get_name_from_tin xmlns="http://tempuri.org/">',
      );
      expect(vatReq!.body).toContain(
        '<is_vat_payer_tin xmlns="http://tempuri.org/">',
      );

      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload).toEqual({
        found: true,
        tin: '206322102',
        taxpayerType: 'legal_entity',
        name: 'შპს მაგალითი',
        isVatPayer: true,
      });
      expect(result.structuredContent).toEqual(payload);
      expect(rawText).not.toContain(config.serviceUser);
      expect(rawText).not.toContain(config.servicePassword);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('looks up an 11-digit individual TIN preserving leading zeros and returning non-VAT status', async () => {
    const requestBodies: string[] = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      requestBodies.push(String(init?.body ?? ''));

      if (soapAction === '"http://tempuri.org/get_name_from_tin"') {
        return xmlResponse(
          getNameFromTinXml('ი/მ &quot;გიორგი &amp; ბერიძე&quot;'),
        );
      }
      if (soapAction === '"http://tempuri.org/is_vat_payer_tin"') {
        return xmlResponse(isVatPayerTinXml(false));
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
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '01001000000',
      });

      expect(result.isError).toBeFalsy();
      expect(requestBodies).toHaveLength(2);
      for (const body of requestBodies) {
        expect(body).toContain('<tin>01001000000</tin>');
      }

      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload).toEqual({
        found: true,
        tin: '01001000000',
        taxpayerType: 'individual',
        name: 'ი/მ "გიორგი & ბერიძე"',
        isVatPayer: false,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns clear not-found result in Georgian and English when RS.ge returns an empty Taxpayer name', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_name_from_tin"') {
        return xmlResponse(getNameFromTinXml(''));
      }
      if (soapAction === '"http://tempuri.org/is_vat_payer_tin"') {
        return xmlResponse(isVatPayerTinXml(false));
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
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '999999999',
      });

      expect(result.isError).toBeFalsy();
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.found).toBe(false);
      expect(payload.tin).toBe('999999999');
      expect(payload.taxpayerType).toBe('legal_entity');
      expect(payload.name).toBeNull();
      expect(payload.isVatPayer).toBe(false);
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/999999999/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      expect(String(payload.hint)).toContain('check_connection');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects malformed TINs with Georgian + English validation error before hitting RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error('fetch must not be called for invalid TINs');
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    const invalidInputs: Array<Record<string, unknown>> = [
      { tin: '' },
      { tin: '12345678' },
      { tin: '1234567890' },
      { tin: '123456789012' },
      { tin: '20632210A' },
      { tin: ' 206322102 ' },
      {},
    ];

    try {
      for (const args of invalidInputs) {
        let caught: unknown;
        try {
          await client.callToolRaw('lookup_taxpayer', args);
        } catch (error) {
          caught = error;
        }

        expect(caught).toBeInstanceOf(Error);
        const message = caught instanceof Error ? caught.message : String(caught);
        expect(message).toMatch(/[ა-ჰ]/);
        expect(message).toMatch(/9-digit.*11-digit|TIN/i);
      }

      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('translates negative RS.ge error codes via the shared error-code translator with redacted output', async () => {
    const secretUser = 'lookup_secret_user:206322102';
    const secretPass = 'lookup-secret-pass-777';
    let errorCodesCalls = 0;

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_name_from_tin"') {
        return xmlResponse(scalarOperationResultXml('get_name_from_tin', -100));
      }
      if (soapAction === '"http://tempuri.org/is_vat_payer_tin"') {
        return xmlResponse(isVatPayerTinXml(false));
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        errorCodesCalls += 1;
        return xmlResponse(errorCodesXml());
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(secretUser, secretPass),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '206322102',
      });

      expect(result.isError).toBe(true);
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-100);
      expect(payload.operation).toBe('get_name_from_tin');
      expect(payload.tin).toBe('206322102');
      expect(payload.georgianText).toBe(
        'სერვისის მომხმარებლის სახელი ან პაროლი არასწორია',
      );
      expect(String(payload.englishText)).toMatch(/credentials|IP/i);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      expect(String(payload.hint)).toMatch(/IP/i);
      expect(payload.knownCode).toBe(true);
      expect(errorCodesCalls).toBe(1);
      expect(rawText).not.toContain(secretUser);
      expect(rawText).not.toContain(secretPass);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('translates negative RESULT.STATUS error codes returned by is_vat_payer_tin', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/get_name_from_tin"') {
        return xmlResponse(getNameFromTinXml('შპს მაგალითი'));
      }
      if (soapAction === '"http://tempuri.org/is_vat_payer_tin"') {
        return xmlResponse(rsgeResultStatusErrorXml('is_vat_payer_tin', -1002));
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
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '206322102',
      });

      expect(result.isError).toBe(true);
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-1002);
      expect(payload.operation).toBe('is_vat_payer_tin');
      expect(payload.tin).toBe('206322102');
      expect(String(payload.georgianText)).toMatch(/[ა-ჰ]/);
      expect(String(payload.englishText)).toMatch(/TIN/i);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns redacted Georgian + English NETWORK_ERROR on transport failure', async () => {
    const secretUser = 'net_secret_user:206322102';
    const secretPass = 'net-secret-pass-42';

    const fakeFetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error(`ECONNRESET for ${secretUser} / ${secretPass}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(secretUser, secretPass),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('lookup_taxpayer', {
        tin: '206322102',
      });

      expect(result.isError).toBe(true);
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.error).toBe('NETWORK_ERROR');
      expect(payload.tin).toBe('206322102');
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      expect(rawText).toContain('[REDACTED]');
      expect(rawText).not.toContain(secretUser);
      expect(rawText).not.toContain(secretPass);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
