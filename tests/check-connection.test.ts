import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, loadConfig } from '../src/config.js';
import { createRsgeServer } from '../src/server.js';
import {
  checkServiceUserInvalidXml,
  checkServiceUserSuccessXml,
  soapFaultXml,
  xmlResponse,
} from './fixtures/soap.js';

describe('RS.ge MCP bootstrap & configuration', () => {
  it('reads Service User credentials and defaults RSGE_ENDPOINT from env', () => {
    const config = loadConfig({
      RSGE_SERVICE_USER: 'demo_user:123456789',
      RSGE_SERVICE_PASSWORD: 'super-secret-password',
    });

    expect(config).toEqual({
      serviceUser: 'demo_user:123456789',
      servicePassword: 'super-secret-password',
      endpoint: DEFAULT_RSGE_ENDPOINT,
    });
    expect(config.endpoint).toBe(
      'https://services.rs.ge/WayBillService/WayBillService.asmx',
    );
  });

  it('supports overriding RSGE_ENDPOINT via environment variable', () => {
    const config = loadConfig({
      RSGE_SERVICE_USER: 'demo_user:123456789',
      RSGE_SERVICE_PASSWORD: 'super-secret-password',
      RSGE_ENDPOINT: 'https://test.rs.ge/WayBillService/WayBillService.asmx',
    });

    expect(config.endpoint).toBe(
      'https://test.rs.ge/WayBillService/WayBillService.asmx',
    );
  });

  it('fails with a Georgian and English message when required credentials are missing', () => {
    expect(() => loadConfig({})).toThrowError(
      /RSGE_SERVICE_USER.*RSGE_SERVICE_PASSWORD/s,
    );

    try {
      loadConfig({ RSGE_SERVICE_USER: 'only_user' });
      expect.fail('Expected loadConfig to throw when password is missing');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Must include Georgian text and English text, and never echo provided credential
      expect(message).toMatch(/[ა-ჰ]/);
      expect(message).toMatch(/RSGE_SERVICE_PASSWORD/);
      expect(message).not.toContain('only_user');
    }
  });

  it('registers check_connection on FastMCP with readOnlyHint and Georgian-primary / English-secondary description', async () => {
    const config = loadConfig({
      RSGE_SERVICE_USER: 'demo_user:123456789',
      RSGE_SERVICE_PASSWORD: 'super-secret-password',
    });
    const server = createRsgeServer({ config, logLevel: 'silent' });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();
      const tool = tools.find((item) => item.name === 'check_connection');

      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.annotations?.destructiveHint).toBe(false);
      // Georgian primary (starts with Georgian) + English secondary
      expect(tool?.description).toMatch(/^[ა-ჰ]/);
      expect(tool?.description).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('check_connection tool via MCP protocol and stubbed fetch', () => {
  it('verifies valid RS.ge Service User credentials via SOAP 1.1 chek_service_user', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
    });

    const config = loadConfig({
      RSGE_SERVICE_USER: 'ტესტი&მომხმარებელი:206322102',
      RSGE_SERVICE_PASSWORD: 'p<a&s>s"word',
    });
    const server = createRsgeServer({
      config,
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('check_connection', {});

      expect(result.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(1);

      const req = capturedRequests[0]!;
      expect(req.url).toBe(DEFAULT_RSGE_ENDPOINT);
      expect(req.init?.method).toBe('POST');

      const headers = new Headers(req.init?.headers);
      expect(headers.get('content-type')).toBe('text/xml; charset=utf-8');
      expect(headers.get('soapaction')).toBe(
        '"http://tempuri.org/chek_service_user"',
      );

      const body = String(req.init?.body);
      expect(body).toContain('<chek_service_user xmlns="http://tempuri.org/">');
      expect(body).toContain('<su>ტესტი&amp;მომხმარებელი:206322102</su>');
      expect(body).toContain('<sp>p&lt;a&amp;s&gt;s&quot;word</sp>');

      const textBlock = result.content[0];
      expect(textBlock?.type).toBe('text');
      const payload = JSON.parse(
        textBlock?.type === 'text' ? textBlock.text : '{}',
      ) as Record<string, unknown>;

      expect(payload.connected).toBe(true);
      expect(payload.unId).toBe(731937);
      expect(payload.serviceUserId).toBe(20350);
      expect(payload.endpoint).toBe(DEFAULT_RSGE_ENDPOINT);
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      // Never leak credentials in tool response
      expect(JSON.stringify(payload)).not.toContain(config.serviceUser);
      expect(JSON.stringify(payload)).not.toContain(config.servicePassword);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns connected: false with a Georgian + English IP-allowlisting hint when credentials are rejected', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(checkServiceUserInvalidXml()),
    );

    const config = loadConfig({
      RSGE_SERVICE_USER: 'bad_user:206322102',
      RSGE_SERVICE_PASSWORD: 'wrong-password-123',
    });
    const server = createRsgeServer({
      config,
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('check_connection', {});

      expect(result.isError).toBeFalsy();
      const textBlock = result.content[0];
      expect(textBlock?.type).toBe('text');
      const payload = JSON.parse(
        textBlock?.type === 'text' ? textBlock.text : '{}',
      ) as Record<string, unknown>;

      expect(payload.connected).toBe(false);
      expect(payload.unId).toBe(-3);
      expect(payload.serviceUserId).toBe(-3);
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      expect(String(payload.hint)).toMatch(/IP/i);
      expect(String(payload.hint)).toMatch(/RS\.ge/i);
      expect(JSON.stringify(payload)).not.toContain(config.serviceUser);
      expect(JSON.stringify(payload)).not.toContain(config.servicePassword);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns structured redacted error and redacts stderr logs on network failure', async () => {
    const secretUser = 'secret_service_user:206322102';
    const secretPass = 'ultra-secret-password-999';

    const fakeFetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error(
        `connect ECONNREFUSED for user=${secretUser} pass=${secretPass}`,
      );
    });

    const logChunks: string[] = [];
    const logStream = new PassThrough();
    logStream.on('data', (chunk: Buffer) => {
      logChunks.push(chunk.toString('utf8'));
    });

    const config = loadConfig({
      RSGE_SERVICE_USER: secretUser,
      RSGE_SERVICE_PASSWORD: secretPass,
    });
    const server = createRsgeServer({
      config,
      fetch: fakeFetch,
      logStream,
      logLevel: 'debug',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('check_connection', {});

      expect(result.isError).toBe(true);
      const textBlock = result.content[0];
      expect(textBlock?.type).toBe('text');
      const rawText = textBlock?.type === 'text' ? textBlock.text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.connected).toBe(false);
      expect(payload.error).toBe('NETWORK_ERROR');
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      expect(rawText).toContain('[REDACTED]');
      expect(rawText).not.toContain(secretUser);
      expect(rawText).not.toContain(secretPass);

      const allLogs = logChunks.join('');
      expect(allLogs.length).toBeGreaterThan(0);
      expect(allLogs).toContain('[REDACTED]');
      expect(allLogs).not.toContain(secretUser);
      expect(allLogs).not.toContain(secretPass);

      // Every emitted log line must be valid JSON
      const lines = allLogs
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('handles Georgian UTF-8 SOAP Fault responses cleanly with redacted output', async () => {
    const secretPass = 'fault-secret-pass';
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(
        soapFaultXml(
          'soap:Client',
          `სერვისის შეცდომა: მოთხოვნა ვერ დამუშავდა (${secretPass})`,
        ),
        500,
      ),
    );

    const config = loadConfig({
      RSGE_SERVICE_USER: 'demo_user:206322102',
      RSGE_SERVICE_PASSWORD: secretPass,
    });
    const server = createRsgeServer({
      config,
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('check_connection', {});

      expect(result.isError).toBe(true);
      const textBlock = result.content[0];
      expect(textBlock?.type).toBe('text');
      const rawText = textBlock?.type === 'text' ? textBlock.text : '';
      const payload = JSON.parse(rawText) as Record<string, unknown>;

      expect(payload.connected).toBe(false);
      expect(payload.error).toBe('SOAP_FAULT');
      expect(payload.faultCode).toBe('soap:Client');
      expect(String(payload.message)).toContain(
        'სერვისის შეცდომა: მოთხოვნა ვერ დამუშავდა',
      );
      expect(rawText).not.toContain(secretPass);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
