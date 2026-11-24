import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { computeCanonicalArgsHash } from '../src/confirmation/index.js';
import { DEFAULT_RSGE_ENDPOINT, loadConfig } from '../src/config.js';
import { createRsgeServer } from '../src/server.js';
import {
  errorCodesXml,
  scalarOperationResultXml,
  xmlResponse,
} from './fixtures/soap.js';
import { getWaybillResponseXml, type WaybillFixture } from './fixtures/waybill.js';

function createTestConfig() {
  return loadConfig({
    RSGE_SERVICE_USER: 'seller_user:206322102',
    RSGE_SERVICE_PASSWORD: 'seller-secret-password',
  });
}

function parseToolJson(result: {
  content: ReadonlyArray<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const first = result.content[0];
  return JSON.parse(
    first && first.type === 'text' && first.text ? first.text : '{}',
  ) as Record<string, unknown>;
}

const DRAFT_WAYBILL: WaybillFixture = {
  id: 1551,
  waybillNumber: '',
  type: 2,
  status: 0,
  sellerTin: '206322102',
  sellerName: 'შპს გამყიდველი',
  sellerUnId: 731937,
  buyerTin: '01002000002',
  buyerName: 'შპს მყიდველი',
  fullAmount: '145.50',
  startAddress: 'თბილისი, რუსთაველის 1',
  endAddress: 'ბათუმი, ჭავჭავაძის 5',
  beginDate: '2026-11-24T12:00:00',
  goods: [
    {
      id: 9001,
      name: 'მინერალური წყალი',
      unitId: 1,
      quantity: '10',
      price: '14.55',
      amount: '145.50',
      vatType: 0,
    },
  ],
};

const ACTIVE_WAYBILL: WaybillFixture = {
  id: 2040,
  waybillNumber: '0000099123',
  type: 2,
  status: 1,
  sellerTin: '206322102',
  sellerName: 'შპს გამყიდველი',
  sellerUnId: 731937,
  buyerTin: '01009008007',
  buyerName: 'ი/მ დავით მაისურაძე',
  fullAmount: '320.00',
  beginDate: '2026-11-24T10:00:00',
  activateDate: '2026-11-24T10:05:00',
  goods: [
    {
      id: 5001,
      name: 'სამშენებლო მასალა',
      unitId: 2,
      quantity: '4',
      price: '80.00',
      amount: '320.00',
      vatType: 0,
    },
  ],
};

describe('Seller Waybill lifecycle tools — discovery', () => {
  it('registers all four Seller lifecycle tools with readOnlyHint: false, destructiveHint: true, and Georgian-primary / English-secondary descriptions', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();

      for (const name of [
        'send_waybill',
        'close_waybill',
        'delete_waybill_draft',
        'cancel_waybill',
      ]) {
        const tool = tools.find((item) => item.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
        expect(tool?.annotations?.readOnlyHint).toBe(false);
        expect(tool?.annotations?.destructiveHint).toBe(true);
        expect(tool?.description).toMatch(/^[ა-ჰ]/);
        expect(tool?.description).toMatch(/[A-Za-z]{4,}/);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Seller Waybill lifecycle tools — preview & confirm execution', () => {

  it('previews send_waybill without calling RS.ge send_waybill, then activates the Waybill when called with the issued confirmation_token', async () => {
    const capturedRequests: Array<{
      url: string;
      soapAction: string | null;
      body: string;
    }> = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ url: String(input), soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', DRAFT_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/send_waybill"') {
        return xmlResponse(scalarOperationResultXml('send_waybill', '0000014722'));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      // Step 1: Preview without confirmation_token
      const previewResult = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
      });
      expect(previewResult.isError).toBeFalsy();

      // Only get_waybill was called — zero mutation calls
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.url).toBe(DEFAULT_RSGE_ENDPOINT);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/get_waybill"',
      );

      const preview = parseToolJson(previewResult);
      expect(preview).toMatchObject({
        requiresConfirmation: true,
        executed: false,
        action: 'send_waybill',
        waybill: {
          id: 1551,
          buyerTin: '01002000002',
          buyerName: 'შპს მყიდველი',
          fullAmount: 145.5,
          status: 0,
          statusGeorgian: 'შენახული',
          statusEnglish: 'Draft',
        },
      });
      expect(typeof preview.confirmation_token).toBe('string');
      expect((preview.confirmation_token as string).length).toBeGreaterThanOrEqual(
        32,
      );
      expect(preview.expiresInSeconds).toBe(300);
      expect(String(preview.summary)).toMatch(/[ა-ჰ]/);
      expect(String(preview.summary)).toMatch(/[A-Za-z]{4,}/);
      expect(String(preview.summary)).toContain('1551');
      expect(String(preview.summary)).toContain('01002000002');
      expect(String(preview.summary)).toContain('145.50');

      // Step 2: Confirm and execute with the issued token
      const confirmResult = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/send_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<send_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>1551</waybill_id>');

      const confirmed = parseToolJson(confirmResult);
      expect(confirmed).toMatchObject({
        executed: true,
        action: 'send_waybill',
        operation: 'send_waybill',
        waybillId: 1551,
        waybillNumber: '0000014722',
        status: 1,
        statusGeorgian: 'გააქტიურებული',
        statusEnglish: 'Active',
      });
      expect(String(confirmed.message)).toMatch(/[ა-ჰ]/);
      expect(String(confirmed.message)).toMatch(/[A-Za-z]{4,}/);
      expect(String(confirmed.message)).toContain('0000014722');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns WAYBILL_NOT_FOUND without issuing a token or calling mutation when target Waybill does not exist', async () => {
    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      return xmlResponse(getWaybillResponseXml('get_waybill', null));
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('send_waybill', {
        waybill_id: 999999,
      });
      expect(result.isError).toBe(true);
      expect(capturedActions).toEqual(['"http://tempuri.org/get_waybill"']);

      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        error: 'WAYBILL_NOT_FOUND',
        found: false,
        executed: false,
        waybillId: 999999,
      });
      expect(payload.confirmation_token).toBeUndefined();
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('previews and executes close_waybill (SOAP close_waybill -> status 2 Completed)', async () => {
    const capturedRequests: Array<{ soapAction: string | null; body: string }> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', ACTIVE_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/close_waybill"') {
        return xmlResponse(scalarOperationResultXml('close_waybill', 1));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const previewResult = await client.callToolRaw('close_waybill', {
        waybill_id: 2040,
      });
      expect(previewResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/get_waybill"',
      );

      const preview = parseToolJson(previewResult);
      expect(preview).toMatchObject({
        requiresConfirmation: true,
        executed: false,
        action: 'close_waybill',
        waybill: {
          id: 2040,
          waybillNumber: '0000099123',
          buyerTin: '01009008007',
          fullAmount: 320,
          status: 1,
          statusGeorgian: 'გააქტიურებული',
          statusEnglish: 'Active',
        },
      });
      expect(String(preview.summary)).toContain('0000099123');
      expect(String(preview.summary)).toContain('01009008007');
      expect(String(preview.summary)).toContain('320.00');

      const confirmResult = await client.callToolRaw('close_waybill', {
        waybill_id: 2040,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/close_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<close_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>2040</waybill_id>');

      expect(parseToolJson(confirmResult)).toMatchObject({
        executed: true,
        action: 'close_waybill',
        operation: 'close_waybill',
        waybillId: 2040,
        status: 2,
        statusGeorgian: 'დასრულებული',
        statusEnglish: 'Completed',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('previews and executes delete_waybill_draft (SOAP del_waybill -> status -1 Deleted)', async () => {
    const capturedRequests: Array<{ soapAction: string | null; body: string }> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', DRAFT_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/del_waybill"') {
        return xmlResponse(scalarOperationResultXml('del_waybill', 1));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const previewResult = await client.callToolRaw('delete_waybill_draft', {
        waybill_id: 1551,
      });
      expect(previewResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/get_waybill"',
      );

      const preview = parseToolJson(previewResult);
      expect(preview).toMatchObject({
        requiresConfirmation: true,
        executed: false,
        action: 'delete_waybill_draft',
        waybill: {
          id: 1551,
          status: 0,
          statusGeorgian: 'შენახული',
          statusEnglish: 'Draft',
        },
      });

      const confirmResult = await client.callToolRaw('delete_waybill_draft', {
        waybill_id: 1551,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/del_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<del_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>1551</waybill_id>');

      expect(parseToolJson(confirmResult)).toMatchObject({
        executed: true,
        action: 'delete_waybill_draft',
        operation: 'del_waybill',
        waybillId: 1551,
        status: -1,
        statusGeorgian: 'წაშლილი',
        statusEnglish: 'Deleted',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('previews and executes cancel_waybill (SOAP ref_waybill -> status -2 Cancelled)', async () => {
    const capturedRequests: Array<{ soapAction: string | null; body: string }> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', ACTIVE_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/ref_waybill"') {
        return xmlResponse(scalarOperationResultXml('ref_waybill', 1));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const previewResult = await client.callToolRaw('cancel_waybill', {
        waybill_id: 2040,
      });
      expect(previewResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/get_waybill"',
      );

      const preview = parseToolJson(previewResult);
      expect(preview).toMatchObject({
        requiresConfirmation: true,
        executed: false,
        action: 'cancel_waybill',
        waybill: {
          id: 2040,
          waybillNumber: '0000099123',
          status: 1,
          statusGeorgian: 'გააქტიურებული',
          statusEnglish: 'Active',
        },
      });

      const confirmResult = await client.callToolRaw('cancel_waybill', {
        waybill_id: 2040,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/ref_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<ref_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>2040</waybill_id>');

      expect(parseToolJson(confirmResult)).toMatchObject({
        executed: true,
        action: 'cancel_waybill',
        operation: 'ref_waybill',
        waybillId: 2040,
        status: -2,
        statusGeorgian: 'გაუქმებული',
        statusEnglish: 'Cancelled',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Two-step confirmation security guardrails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects tampered arguments, wrong tool name, and unknown tokens with Georgian + English errors and zero mutation calls', async () => {
    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', DRAFT_WAYBILL));
      }
      throw new Error(`Mutation SOAPAction should NOT be called: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const previewResult = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
      });
      const token = parseToolJson(previewResult).confirmation_token as string;
      expect(capturedActions).toEqual(['"http://tempuri.org/get_waybill"']);

      // 1. Tampered argument (different waybill_id)
      const tampered = await client.callToolRaw('send_waybill', {
        waybill_id: 9999,
        confirmation_token: token,
      });
      expect(tampered.isError).toBe(true);
      const tamperedPayload = parseToolJson(tampered);
      expect(tamperedPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_ARGS_MISMATCH',
        action: 'send_waybill',
        waybillId: 9999,
      });
      expect(String(tamperedPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(tamperedPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // 2. Wrong tool with same waybill_id
      const wrongTool = await client.callToolRaw('delete_waybill_draft', {
        waybill_id: 1551,
        confirmation_token: token,
      });
      expect(wrongTool.isError).toBe(true);
      const wrongToolPayload = parseToolJson(wrongTool);
      expect(wrongToolPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_TOOL_MISMATCH',
        action: 'delete_waybill_draft',
        waybillId: 1551,
      });
      expect(String(wrongToolPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(wrongToolPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // 3. Unknown / forged token
      const unknown = await client.callToolRaw('cancel_waybill', {
        waybill_id: 2040,
        confirmation_token: 'forged-token-value-1234567890',
      });
      expect(unknown.isError).toBe(true);
      const unknownPayload = parseToolJson(unknown);
      expect(unknownPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_INVALID',
        action: 'cancel_waybill',
        waybillId: 2040,
      });
      expect(String(unknownPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(unknownPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // Still only the single initial get_waybill preview call — ZERO mutation calls
      expect(capturedActions).toEqual(['"http://tempuri.org/get_waybill"']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects single-use token replay with CONFIRMATION_TOKEN_ALREADY_USED and zero additional RS.ge calls', async () => {
    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', ACTIVE_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/close_waybill"') {
        return xmlResponse(scalarOperationResultXml('close_waybill', 1));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const preview = parseToolJson(
        await client.callToolRaw('close_waybill', { waybill_id: 2040 }),
      );
      const token = preview.confirmation_token as string;

      const firstExec = await client.callToolRaw('close_waybill', {
        waybill_id: 2040,
        confirmation_token: token,
      });
      expect(firstExec.isError).toBeFalsy();
      expect(capturedActions).toEqual([
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/close_waybill"',
      ]);

      // Replay the exact same token + arguments
      const replay = await client.callToolRaw('close_waybill', {
        waybill_id: 2040,
        confirmation_token: token,
      });
      expect(replay.isError).toBe(true);
      const replayPayload = parseToolJson(replay);
      expect(replayPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_ALREADY_USED',
        action: 'close_waybill',
        waybillId: 2040,
      });
      expect(String(replayPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(replayPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // Zero additional SOAP calls on replay
      expect(capturedActions).toHaveLength(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('accepts tokens before 5 minutes and rejects tokens expired after 5 minutes using Vitest fake timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));

    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', DRAFT_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/send_waybill"') {
        return xmlResponse(scalarOperationResultXml('send_waybill', '0000014722'));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const previewA = parseToolJson(
        await client.callToolRaw('send_waybill', { waybill_id: 1551 }),
      );
      const previewB = parseToolJson(
        await client.callToolRaw('send_waybill', { waybill_id: 1551 }),
      );
      const tokenA = previewA.confirmation_token as string;
      const tokenB = previewB.confirmation_token as string;
      expect(tokenA).not.toBe(tokenB);

      // Advance 4m 59s — tokenA is still valid
      vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
      const validExec = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
        confirmation_token: tokenA,
      });
      expect(validExec.isError).toBeFalsy();
      expect(capturedActions).toEqual([
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/send_waybill"',
      ]);

      // Advance 2 more seconds (total 5m 01s) — tokenB is now expired
      vi.advanceTimersByTime(2 * 1000);
      const expiredExec = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
        confirmation_token: tokenB,
      });
      expect(expiredExec.isError).toBe(true);
      const expiredPayload = parseToolJson(expiredExec);
      expect(expiredPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_EXPIRED',
        action: 'send_waybill',
        waybillId: 1551,
      });
      expect(String(expiredPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(expiredPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // Zero extra SOAP calls for the expired token
      expect(capturedActions).toHaveLength(3);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('computes deterministic canonical hashes regardless of key ordering while excluding confirmation_token', () => {
    const hashA = computeCanonicalArgsHash({
      waybill_id: 1551,
      nested: { b: 2, a: 1 },
      confirmation_token: 'token-1',
    });
    const hashB = computeCanonicalArgsHash({
      nested: { a: 1, b: 2, ignored: undefined },
      waybill_id: 1551,
      confirmation_token: 'token-2',
    });
    const hashDifferent = computeCanonicalArgsHash({
      waybill_id: 1552,
      nested: { a: 1, b: 2 },
    });

    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashDifferent);
  });

  it('rejects invalid waybill_id and empty confirmation_token via Zod before calling RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(
        client.callToolRaw('send_waybill', { waybill_id: 0 }),
      ).rejects.toThrow(/ზედნადების ID.*waybill_id/i);

      await expect(
        client.callToolRaw('close_waybill', { waybill_id: -5 }),
      ).rejects.toThrow(/ზედნადების ID.*waybill_id/i);

      await expect(
        client.callToolRaw('delete_waybill_draft', {
          waybill_id: 1551,
          confirmation_token: '   ',
        }),
      ).rejects.toThrow(/დადასტურების ტოკენი.*confirmation_token/i);

      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Seller Waybill lifecycle — RS.ge error translation & failure edge cases', () => {
  it('translates negative RS.ge error codes across all four mutations without leaking credentials and still consumes the token', async () => {
    const errorCases: ReadonlyArray<{
      toolName: 'send_waybill' | 'close_waybill' | 'delete_waybill_draft' | 'cancel_waybill';
      soapOperation: 'send_waybill' | 'close_waybill' | 'del_waybill' | 'ref_waybill';
      errorValue: string | number;
      expectedCode: number;
    }> = [
      {
        toolName: 'send_waybill',
        soapOperation: 'send_waybill',
        errorValue: '-101',
        expectedCode: -101,
      },
      {
        toolName: 'close_waybill',
        soapOperation: 'close_waybill',
        errorValue: -1,
        expectedCode: -1,
      },
      {
        toolName: 'delete_waybill_draft',
        soapOperation: 'del_waybill',
        errorValue: -1,
        expectedCode: -1,
      },
      {
        toolName: 'cancel_waybill',
        soapOperation: 'ref_waybill',
        errorValue: -100,
        expectedCode: -100,
      },
    ];

    for (const tc of errorCases) {
      const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
        const soapAction = new Headers(init?.headers).get('soapaction');
        if (soapAction === '"http://tempuri.org/get_waybill"') {
          return xmlResponse(getWaybillResponseXml('get_waybill', ACTIVE_WAYBILL));
        }
        if (soapAction === `"http://tempuri.org/${tc.soapOperation}"`) {
          return xmlResponse(
            scalarOperationResultXml(tc.soapOperation, tc.errorValue),
          );
        }
        if (soapAction === '"http://tempuri.org/get_error_codes"') {
          return xmlResponse(errorCodesXml());
        }
        throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
      });

      const server = createRsgeServer({
        config: createTestConfig(),
        fetch: fakeFetch,
        logLevel: 'silent',
      });
      const client = await Client.connect(server);

      try {
        const preview = parseToolJson(
          await client.callToolRaw(tc.toolName, { waybill_id: 2040 }),
        );
        const token = preview.confirmation_token as string;

        const failedExec = await client.callToolRaw(tc.toolName, {
          waybill_id: 2040,
          confirmation_token: token,
        });
        expect(failedExec.isError).toBe(true);

        const rawText =
          failedExec.content[0]?.type === 'text' ? failedExec.content[0].text : '';
        expect(rawText).not.toContain('seller_user:206322102');
        expect(rawText).not.toContain('seller-secret-password');

        const payload = parseToolJson(failedExec);
        expect(payload).toMatchObject({
          executed: false,
          error: 'RSGE_API_ERROR',
          code: tc.expectedCode,
          operation: tc.soapOperation,
          waybillId: 2040,
          knownCode: true,
        });
        expect(String(payload.georgianText)).toMatch(/[ა-ჰ]/);
        expect(String(payload.englishText)).toMatch(/[A-Za-z]{4,}/);
        expect(String(payload.hint)).toMatch(/[ა-ჰ]/);

        // Token was consumed even though RS.ge returned an error — cannot replay
        const replayAfterError = await client.callToolRaw(tc.toolName, {
          waybill_id: 2040,
          confirmation_token: token,
        });
        expect(replayAfterError.isError).toBe(true);
        expect(parseToolJson(replayAfterError)).toMatchObject({
          error: 'CONFIRMATION_TOKEN_ALREADY_USED',
          executed: false,
        });
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it('returns RSGE_MUTATION_FAILED when send_waybill returns empty string or close_waybill returns 0', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', DRAFT_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/send_waybill"') {
        return xmlResponse(scalarOperationResultXml('send_waybill', ''));
      }
      if (soapAction === '"http://tempuri.org/close_waybill"') {
        return xmlResponse(scalarOperationResultXml('close_waybill', 0));
      }
      throw new Error(`Unexpected SOAPAction: ${String(soapAction)}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const sendPreview = parseToolJson(
        await client.callToolRaw('send_waybill', { waybill_id: 1551 }),
      );
      const sendResult = await client.callToolRaw('send_waybill', {
        waybill_id: 1551,
        confirmation_token: sendPreview.confirmation_token,
      });
      expect(sendResult.isError).toBe(true);
      expect(parseToolJson(sendResult)).toMatchObject({
        executed: false,
        error: 'RSGE_MUTATION_FAILED',
        operation: 'send_waybill',
        waybillId: 1551,
      });

      const closePreview = parseToolJson(
        await client.callToolRaw('close_waybill', { waybill_id: 1551 }),
      );
      const closeResult = await client.callToolRaw('close_waybill', {
        waybill_id: 1551,
        confirmation_token: closePreview.confirmation_token,
      });
      expect(closeResult.isError).toBe(true);
      expect(parseToolJson(closeResult)).toMatchObject({
        executed: false,
        error: 'RSGE_MUTATION_FAILED',
        operation: 'close_waybill',
        waybillId: 1551,
        resultCode: 0,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
