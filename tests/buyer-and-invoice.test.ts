import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, createRsgeServer } from '../src/index.js';
import { createTestConfig as createBaseTestConfig, parseToolJson } from './fixtures/mcp.js';
import {
  errorCodesXml,
  rsgeResultStatusErrorXml,
  saveInvoiceResultXml,
  scalarOperationResultXml,
  xmlResponse,
} from './fixtures/soap.js';
import { getWaybillResponseXml, type WaybillFixture } from './fixtures/waybill.js';

function createTestConfig() {
  return createBaseTestConfig('buyer_user:206322102', 'buyer-secret-password');
}

const INCOMING_WAYBILL: WaybillFixture = {
  id: 3101,
  waybillNumber: '0000188421',
  type: 2,
  status: 1,
  sellerTin: '205001122',
  sellerName: 'შპს მომწოდებელი',
  sellerUnId: 551100,
  buyerTin: '206322102',
  buyerName: 'შპს მყიდველი',
  fullAmount: '540.75',
  beginDate: '2026-11-24T09:00:00',
  activateDate: '2026-11-24T09:10:00',
  isConfirmed: 0,
  goods: [
    {
      id: 7101,
      name: 'ელექტრო კაბელი',
      unitId: 1,
      quantity: '15',
      price: '36.05',
      amount: '540.75',
      vatType: 0,
    },
  ],
};

const COMPLETED_OUTGOING_WAYBILL: WaybillFixture = {
  id: 4205,
  waybillNumber: '0000244890',
  type: 2,
  status: 2,
  sellerTin: '206322102',
  sellerName: 'შპს გამყიდველი',
  sellerUnId: 731937,
  buyerTin: '404556677',
  buyerName: 'შპს მიმღები',
  fullAmount: '1250.00',
  beginDate: '2026-11-23T11:00:00',
  activateDate: '2026-11-23T11:05:00',
  closeDate: '2026-11-23T17:30:00',
  isConfirmed: 1,
  goods: [
    {
      id: 8201,
      name: 'სერვერული კარადა',
      unitId: 1,
      quantity: '2',
      price: '625.00',
      amount: '1250.00',
      vatType: 0,
    },
  ],
};

describe('Buyer actions & Tax Invoice tools — discovery', () => {
  it('registers confirm_waybill, reject_waybill, and create_waybill_invoice with readOnlyHint: false, destructiveHint: true, Georgian-primary / English-secondary descriptions, completing all 13 spec tools', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();

      for (const name of [
        'confirm_waybill',
        'reject_waybill',
        'create_waybill_invoice',
      ]) {
        const tool = tools.find((item) => item.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
        expect(tool?.annotations?.readOnlyHint).toBe(false);
        expect(tool?.annotations?.destructiveHint).toBe(true);
        expect(tool?.description).toMatch(/^[ა-ჰ]/);
        expect(tool?.description).toMatch(/[A-Za-z]{4,}/);
      }

      // Verify all 13 v1 spec tools are registered cleanly
      const expectedTools = [
        'check_connection',
        'lookup_taxpayer',
        'get_reference_data',
        'get_waybill',
        'list_waybills',
        'save_waybill_draft',
        'send_waybill',
        'close_waybill',
        'delete_waybill_draft',
        'cancel_waybill',
        'confirm_waybill',
        'reject_waybill',
        'create_waybill_invoice',
      ];
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        [...expectedTools].sort(),
      );
      expect(tools).toHaveLength(13);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Buyer actions & Tax Invoice tools — preview & confirm execution', () => {

  it('previews confirm_waybill without calling RS.ge confirm_waybill, then confirms the incoming Waybill with the issued confirmation_token', async () => {
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
        return xmlResponse(getWaybillResponseXml('get_waybill', INCOMING_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/confirm_waybill"') {
        return xmlResponse(scalarOperationResultXml('confirm_waybill', true));
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
      const previewResult = await client.callToolRaw('confirm_waybill', {
        waybill_id: 3101,
      });
      expect(previewResult.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]?.url).toBe(DEFAULT_RSGE_ENDPOINT);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/get_waybill"',
      );

      const preview = parseToolJson(previewResult);
      expect(preview).toMatchObject({
        requiresConfirmation: true,
        executed: false,
        action: 'confirm_waybill',
        expiresInSeconds: 300,
        waybill: {
          id: 3101,
          waybillNumber: '0000188421',
          sellerTin: '205001122',
          sellerName: 'შპს მომწოდებელი',
          buyerTin: '206322102',
          buyerName: 'შპს მყიდველი',
          fullAmount: 540.75,
          status: 1,
          statusGeorgian: 'გააქტიურებული',
          statusEnglish: 'Active',
        },
      });
      expect(typeof preview.confirmation_token).toBe('string');
      expect((preview.confirmation_token as string).length).toBeGreaterThanOrEqual(
        32,
      );
      expect(String(preview.summary)).toMatch(/[ა-ჰ]/);
      expect(String(preview.summary)).toMatch(/[A-Za-z]{4,}/);
      expect(String(preview.summary)).toContain('3101');
      expect(String(preview.summary)).toContain('0000188421');
      expect(String(preview.summary)).toContain('205001122');
      expect(String(preview.summary)).toContain('206322102');
      expect(String(preview.summary)).toContain('540.75');

      const confirmResult = await client.callToolRaw('confirm_waybill', {
        waybill_id: 3101,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/confirm_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<confirm_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>3101</waybill_id>');

      const confirmed = parseToolJson(confirmResult);
      expect(confirmed).toMatchObject({
        executed: true,
        action: 'confirm_waybill',
        operation: 'confirm_waybill',
        waybillId: 3101,
        confirmed: true,
        confirmationStatus: 1,
        confirmationStatusGeorgian: 'დადასტურებული',
        confirmationStatusEnglish: 'Confirmed',
      });
      expect(String(confirmed.message)).toMatch(/[ა-ჰ]/);
      expect(String(confirmed.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('previews reject_waybill without calling RS.ge reject_waybill, then rejects the incoming Waybill with the issued confirmation_token', async () => {
    const capturedRequests: Array<{ soapAction: string | null; body: string }> = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', INCOMING_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/reject_waybill"') {
        return xmlResponse(scalarOperationResultXml('reject_waybill', true));
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
      const previewResult = await client.callToolRaw('reject_waybill', {
        waybill_id: 3101,
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
        action: 'reject_waybill',
        expiresInSeconds: 300,
        waybill: {
          id: 3101,
          waybillNumber: '0000188421',
          sellerTin: '205001122',
          buyerTin: '206322102',
          fullAmount: 540.75,
        },
      });
      expect(String(preview.summary)).toMatch(/[ა-ჰ]/);
      expect(String(preview.summary)).toMatch(/[A-Za-z]{4,}/);
      expect(String(preview.summary)).toContain('0000188421');
      expect(String(preview.summary)).toContain('205001122');

      const confirmResult = await client.callToolRaw('reject_waybill', {
        waybill_id: 3101,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/reject_waybill"',
      );
      expect(capturedRequests[1]?.body).toContain(
        '<reject_waybill xmlns="http://tempuri.org/">',
      );
      expect(capturedRequests[1]?.body).toContain('<waybill_id>3101</waybill_id>');

      const rejected = parseToolJson(confirmResult);
      expect(rejected).toMatchObject({
        executed: true,
        action: 'reject_waybill',
        operation: 'reject_waybill',
        waybillId: 3101,
        rejected: true,
        confirmationStatus: -1,
        confirmationStatusGeorgian: 'უარყოფილი',
        confirmationStatusEnglish: 'Rejected',
      });
      expect(String(rejected.message)).toMatch(/[ა-ჰ]/);
      expect(String(rejected.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns RSGE_MUTATION_FAILED when confirm_waybill or reject_waybill returns false from RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', INCOMING_WAYBILL));
      }
      if (soapAction === '"http://tempuri.org/confirm_waybill"') {
        return xmlResponse(scalarOperationResultXml('confirm_waybill', false));
      }
      if (soapAction === '"http://tempuri.org/reject_waybill"') {
        return xmlResponse(scalarOperationResultXml('reject_waybill', false));
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
      const confirmPreview = parseToolJson(
        await client.callToolRaw('confirm_waybill', { waybill_id: 3101 }),
      );
      const confirmRes = await client.callToolRaw('confirm_waybill', {
        waybill_id: 3101,
        confirmation_token: confirmPreview.confirmation_token,
      });
      expect(confirmRes.isError).toBe(true);
      const confirmPayload = parseToolJson(confirmRes);
      expect(confirmPayload).toMatchObject({
        executed: false,
        action: 'confirm_waybill',
        operation: 'confirm_waybill',
        waybillId: 3101,
        confirmed: false,
        error: 'RSGE_MUTATION_FAILED',
      });
      expect(String(confirmPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(confirmPayload.message)).toMatch(/[A-Za-z]{4,}/);

      const rejectPreview = parseToolJson(
        await client.callToolRaw('reject_waybill', { waybill_id: 3101 }),
      );
      const rejectRes = await client.callToolRaw('reject_waybill', {
        waybill_id: 3101,
        confirmation_token: rejectPreview.confirmation_token,
      });
      expect(rejectRes.isError).toBe(true);
      const rejectPayload = parseToolJson(rejectRes);
      expect(rejectPayload).toMatchObject({
        executed: false,
        action: 'reject_waybill',
        operation: 'reject_waybill',
        waybillId: 3101,
        rejected: false,
        error: 'RSGE_MUTATION_FAILED',
      });
      expect(String(rejectPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(rejectPayload.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('previews create_waybill_invoice without calling save_invoice, then executes save_invoice with exact WSDL param order and returns invoiceId', async () => {
    const capturedRequests: Array<{ soapAction: string | null; body: string }> = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      const body = String(init?.body ?? '');
      capturedRequests.push({ soapAction, body });

      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(
          getWaybillResponseXml('get_waybill', COMPLETED_OUTGOING_WAYBILL),
        );
      }
      if (soapAction === '"http://tempuri.org/save_invoice"') {
        return xmlResponse(saveInvoiceResultXml(1, 456789));
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
      const previewResult = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
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
        action: 'create_waybill_invoice',
        expiresInSeconds: 300,
        waybill: {
          id: 4205,
          waybillNumber: '0000244890',
          sellerTin: '206322102',
          buyerTin: '404556677',
          fullAmount: 1250,
          status: 2,
          statusGeorgian: 'დასრულებული',
          statusEnglish: 'Completed',
        },
      });
      expect(String(preview.summary)).toMatch(/[ა-ჰ]/);
      expect(String(preview.summary)).toMatch(/[A-Za-z]{4,}/);
      expect(String(preview.summary)).toContain('4205');
      expect(String(preview.summary)).toContain('0000244890');
      expect(String(preview.summary)).toContain('206322102');
      expect(String(preview.summary)).toContain('404556677');
      expect(String(preview.summary)).toContain('1250.00');
      expect(String(preview.summary)).toContain('ანგარიშ-ფაქტურა');
      expect(String(preview.summary)).toContain('Tax Invoice');

      const confirmResult = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
        confirmation_token: preview.confirmation_token,
      });
      expect(confirmResult.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[1]?.soapAction).toBe(
        '"http://tempuri.org/save_invoice"',
      );
      const soapBody = capturedRequests[1]?.body ?? '';
      expect(soapBody).toContain('<save_invoice xmlns="http://tempuri.org/">');
      // Assert exact WSDL sequence order: su -> sp -> waybill_id -> in_inv_id
      const suIdx = soapBody.indexOf('<su>');
      const spIdx = soapBody.indexOf('<sp>');
      const wbIdx = soapBody.indexOf('<waybill_id>4205</waybill_id>');
      const invIdx = soapBody.indexOf('<in_inv_id>0</in_inv_id>');
      expect(suIdx).toBeGreaterThan(-1);
      expect(spIdx).toBeGreaterThan(suIdx);
      expect(wbIdx).toBeGreaterThan(spIdx);
      expect(invIdx).toBeGreaterThan(wbIdx);

      const created = parseToolJson(confirmResult);
      expect(created).toMatchObject({
        executed: true,
        action: 'create_waybill_invoice',
        operation: 'save_invoice',
        waybillId: 4205,
        invoiceId: 456789,
      });
      expect(String(created.message)).toMatch(/[ა-ჰ]/);
      expect(String(created.message)).toMatch(/[A-Za-z]{4,}/);
      expect(String(created.message)).toContain('456789');
      expect(String(created.message)).toContain('4205');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns RSGE_MUTATION_FAILED when save_invoice returns non-1 result code or zero out_inv_id', async () => {
    let invoiceCallCount = 0;
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(
          getWaybillResponseXml('get_waybill', COMPLETED_OUTGOING_WAYBILL),
        );
      }
      if (soapAction === '"http://tempuri.org/save_invoice"') {
        invoiceCallCount += 1;
        return xmlResponse(
          invoiceCallCount === 1
            ? saveInvoiceResultXml(0, 0)
            : saveInvoiceResultXml(1, 0),
        );
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
      const preview1 = parseToolJson(
        await client.callToolRaw('create_waybill_invoice', { waybill_id: 4205 }),
      );
      const res1 = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
        confirmation_token: preview1.confirmation_token,
      });
      expect(res1.isError).toBe(true);
      expect(parseToolJson(res1)).toMatchObject({
        executed: false,
        action: 'create_waybill_invoice',
        operation: 'save_invoice',
        waybillId: 4205,
        resultCode: 0,
        error: 'RSGE_MUTATION_FAILED',
      });

      const preview2 = parseToolJson(
        await client.callToolRaw('create_waybill_invoice', { waybill_id: 4205 }),
      );
      const res2 = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
        confirmation_token: preview2.confirmation_token,
      });
      expect(res2.isError).toBe(true);
      expect(parseToolJson(res2)).toMatchObject({
        executed: false,
        action: 'create_waybill_invoice',
        operation: 'save_invoice',
        waybillId: 4205,
        resultCode: 1,
        invoiceId: 0,
        error: 'RSGE_MUTATION_FAILED',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('Buyer actions & Tax Invoice — two-step confirmation guardrails', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns WAYBILL_NOT_FOUND without issuing a token when target Waybill does not exist', async () => {
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
      for (const toolName of [
        'confirm_waybill',
        'reject_waybill',
        'create_waybill_invoice',
      ]) {
        const result = await client.callToolRaw(toolName, { waybill_id: 999888 });
        expect(result.isError).toBe(true);
        const payload = parseToolJson(result);
        expect(payload).toMatchObject({
          error: 'WAYBILL_NOT_FOUND',
          found: false,
          executed: false,
          action: toolName,
          waybillId: 999888,
        });
        expect(payload.confirmation_token).toBeUndefined();
        expect(String(payload.message)).toMatch(/[ა-ჰ]/);
        expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
      }

      expect(capturedActions).toEqual([
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/get_waybill"',
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects tampered waybill_id, cross-tool token misuse, and unknown tokens across all three tools with zero mutation calls', async () => {
    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(getWaybillResponseXml('get_waybill', INCOMING_WAYBILL));
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
      const confirmPreview = parseToolJson(
        await client.callToolRaw('confirm_waybill', { waybill_id: 3101 }),
      );
      const token = confirmPreview.confirmation_token as string;
      expect(capturedActions).toEqual(['"http://tempuri.org/get_waybill"']);

      // 1. Tampered waybill_id
      const tampered = await client.callToolRaw('confirm_waybill', {
        waybill_id: 9999,
        confirmation_token: token,
      });
      expect(tampered.isError).toBe(true);
      expect(parseToolJson(tampered)).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_ARGS_MISMATCH',
        action: 'confirm_waybill',
        waybillId: 9999,
      });

      // 2. Cross-tool misuse: confirm_waybill token used on reject_waybill
      const wrongBuyerTool = await client.callToolRaw('reject_waybill', {
        waybill_id: 3101,
        confirmation_token: token,
      });
      expect(wrongBuyerTool.isError).toBe(true);
      expect(parseToolJson(wrongBuyerTool)).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_TOOL_MISMATCH',
        action: 'reject_waybill',
        waybillId: 3101,
      });

      // 3. Cross-tool misuse: confirm_waybill token used on create_waybill_invoice
      const wrongInvoiceTool = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 3101,
        confirmation_token: token,
      });
      expect(wrongInvoiceTool.isError).toBe(true);
      expect(parseToolJson(wrongInvoiceTool)).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_TOOL_MISMATCH',
        action: 'create_waybill_invoice',
        waybillId: 3101,
      });

      // 4. Forged/unknown token on create_waybill_invoice
      const unknown = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
        confirmation_token: 'forged-invoice-token-abcdef123456',
      });
      expect(unknown.isError).toBe(true);
      expect(parseToolJson(unknown)).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_INVALID',
        action: 'create_waybill_invoice',
        waybillId: 4205,
      });

      // Zero mutation calls made
      expect(capturedActions).toEqual(['"http://tempuri.org/get_waybill"']);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects replayed single-use tokens for confirm_waybill, reject_waybill, and create_waybill_invoice without calling RS.ge again', async () => {
    const cases: ReadonlyArray<{
      toolName: 'confirm_waybill' | 'reject_waybill' | 'create_waybill_invoice';
      soapAction: string;
      responseXml: string;
      waybillId: number;
    }> = [
      {
        toolName: 'confirm_waybill',
        soapAction: '"http://tempuri.org/confirm_waybill"',
        responseXml: scalarOperationResultXml('confirm_waybill', true),
        waybillId: 3101,
      },
      {
        toolName: 'reject_waybill',
        soapAction: '"http://tempuri.org/reject_waybill"',
        responseXml: scalarOperationResultXml('reject_waybill', true),
        waybillId: 3101,
      },
      {
        toolName: 'create_waybill_invoice',
        soapAction: '"http://tempuri.org/save_invoice"',
        responseXml: saveInvoiceResultXml(1, 555001),
        waybillId: 4205,
      },
    ];

    for (const tc of cases) {
      const capturedActions: Array<string | null> = [];
      const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
        const soapAction = new Headers(init?.headers).get('soapaction');
        capturedActions.push(soapAction);
        if (soapAction === '"http://tempuri.org/get_waybill"') {
          return xmlResponse(
            getWaybillResponseXml('get_waybill', COMPLETED_OUTGOING_WAYBILL),
          );
        }
        if (soapAction === tc.soapAction) {
          return xmlResponse(tc.responseXml);
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
          await client.callToolRaw(tc.toolName, { waybill_id: tc.waybillId }),
        );
        const token = preview.confirmation_token as string;

        const firstExec = await client.callToolRaw(tc.toolName, {
          waybill_id: tc.waybillId,
          confirmation_token: token,
        });
        expect(firstExec.isError).toBeFalsy();
        expect(capturedActions).toEqual([
          '"http://tempuri.org/get_waybill"',
          tc.soapAction,
        ]);

        const replay = await client.callToolRaw(tc.toolName, {
          waybill_id: tc.waybillId,
          confirmation_token: token,
        });
        expect(replay.isError).toBe(true);
        const replayPayload = parseToolJson(replay);
        expect(replayPayload).toMatchObject({
          executed: false,
          error: 'CONFIRMATION_TOKEN_ALREADY_USED',
          action: tc.toolName,
          waybillId: tc.waybillId,
        });
        expect(String(replayPayload.message)).toMatch(/[ა-ჰ]/);
        expect(String(replayPayload.message)).toMatch(/[A-Za-z]{4,}/);
        expect(capturedActions).toHaveLength(2);
      } finally {
        await client.close();
        await server.close();
      }
    }
  });

  it('expires confirmation tokens after 5 minutes using Vitest fake timers without invoking RS.ge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T15:00:00.000Z'));

    const capturedActions: Array<string | null> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      capturedActions.push(soapAction);
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(
          getWaybillResponseXml('get_waybill', COMPLETED_OUTGOING_WAYBILL),
        );
      }
      if (soapAction === '"http://tempuri.org/save_invoice"') {
        return xmlResponse(saveInvoiceResultXml(1, 777123));
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
      const previewValid = parseToolJson(
        await client.callToolRaw('create_waybill_invoice', { waybill_id: 4205 }),
      );
      const previewExpire = parseToolJson(
        await client.callToolRaw('confirm_waybill', { waybill_id: 4205 }),
      );

      // Advance 4m 59s -> still valid
      vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
      const execValid = await client.callToolRaw('create_waybill_invoice', {
        waybill_id: 4205,
        confirmation_token: previewValid.confirmation_token,
      });
      expect(execValid.isError).toBeFalsy();
      expect(capturedActions).toEqual([
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/get_waybill"',
        '"http://tempuri.org/save_invoice"',
      ]);

      // Advance 2s (total 5m 01s) -> expired
      vi.advanceTimersByTime(2 * 1000);
      const execExpired = await client.callToolRaw('confirm_waybill', {
        waybill_id: 4205,
        confirmation_token: previewExpire.confirmation_token,
      });
      expect(execExpired.isError).toBe(true);
      const expiredPayload = parseToolJson(execExpired);
      expect(expiredPayload).toMatchObject({
        executed: false,
        error: 'CONFIRMATION_TOKEN_EXPIRED',
        action: 'confirm_waybill',
        waybillId: 4205,
      });
      expect(String(expiredPayload.message)).toMatch(/[ა-ჰ]/);
      expect(String(expiredPayload.message)).toMatch(/[A-Za-z]{4,}/);

      // Zero extra SOAP calls for expired token
      expect(capturedActions).toHaveLength(3);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects invalid waybill_id and blank confirmation_token via Zod before calling RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(
        client.callToolRaw('confirm_waybill', { waybill_id: 0 }),
      ).rejects.toThrow(/ზედნადების ID.*waybill_id/i);

      await expect(
        client.callToolRaw('reject_waybill', { waybill_id: -10 }),
      ).rejects.toThrow(/ზედნადების ID.*waybill_id/i);

      await expect(
        client.callToolRaw('create_waybill_invoice', {
          waybill_id: 4205,
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

describe('Buyer actions & Tax Invoice — RS.ge error translation & redaction', () => {
  it('translates negative RS.ge error codes across confirm_waybill, reject_waybill, and create_waybill_invoice without leaking credentials and consumes tokens', async () => {
    const errorCases: ReadonlyArray<{
      toolName: 'confirm_waybill' | 'reject_waybill' | 'create_waybill_invoice';
      soapOperation: 'confirm_waybill' | 'reject_waybill' | 'save_invoice';
      errorXml: string;
      expectedCode: number;
    }> = [
      {
        toolName: 'confirm_waybill',
        soapOperation: 'confirm_waybill',
        errorXml: rsgeResultStatusErrorXml('confirm_waybill', -100),
        expectedCode: -100,
      },
      {
        toolName: 'reject_waybill',
        soapOperation: 'reject_waybill',
        errorXml: scalarOperationResultXml('reject_waybill', -101),
        expectedCode: -101,
      },
      {
        toolName: 'create_waybill_invoice',
        soapOperation: 'save_invoice',
        errorXml: saveInvoiceResultXml(-3001, 0),
        expectedCode: -3001,
      },
      {
        toolName: 'create_waybill_invoice',
        soapOperation: 'save_invoice',
        errorXml: saveInvoiceResultXml(-3002, 0),
        expectedCode: -3002,
      },
    ];

    for (const tc of errorCases) {
      const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
        const soapAction = new Headers(init?.headers).get('soapaction');
        if (soapAction === '"http://tempuri.org/get_waybill"') {
          return xmlResponse(
            getWaybillResponseXml('get_waybill', COMPLETED_OUTGOING_WAYBILL),
          );
        }
        if (soapAction === `"http://tempuri.org/${tc.soapOperation}"`) {
          return xmlResponse(tc.errorXml);
        }
        if (soapAction === '"http://tempuri.org/get_error_codes"') {
          return xmlResponse(
            errorCodesXml([
              {
                id: -100,
                text: 'სერვისის მომხმარებლის სახელი ან პაროლი არასწორია',
                type: 1,
              },
              {
                id: -101,
                text: 'ზედნადები არ ეკუთვნის გადამხდელს',
                type: 1,
              },
              {
                id: -3001,
                text: 'ანგარიშ-ფაქტურა უკვე გამოწერილია ამ ზედნადებზე',
                type: 3,
              },
              {
                id: -3002,
                text: 'გადამხდელი არ არის დღგ-ის გადამხდელი',
                type: 3,
              },
            ]),
          );
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
          await client.callToolRaw(tc.toolName, { waybill_id: 4205 }),
        );
        const token = preview.confirmation_token as string;

        const failedExec = await client.callToolRaw(tc.toolName, {
          waybill_id: 4205,
          confirmation_token: token,
        });
        expect(failedExec.isError).toBe(true);

        const rawText =
          failedExec.content[0]?.type === 'text' ? failedExec.content[0].text : '';
        expect(rawText).not.toContain('buyer_user:206322102');
        expect(rawText).not.toContain('buyer-secret-password');

        const payload = parseToolJson(failedExec);
        expect(payload).toMatchObject({
          executed: false,
          error: 'RSGE_API_ERROR',
          code: tc.expectedCode,
          operation: tc.soapOperation,
          waybillId: 4205,
          knownCode: true,
        });
        expect(String(payload.georgianText)).toMatch(/[ა-ჰ]/);
        expect(String(payload.englishText)).toMatch(/[A-Za-z]{4,}/);
        expect(String(payload.hint)).toMatch(/[ა-ჰ]/);

        // Token is consumed even when RS.ge returned a negative error code
        const replayAfterError = await client.callToolRaw(tc.toolName, {
          waybill_id: 4205,
          confirmation_token: token,
        });
        expect(replayAfterError.isError).toBe(true);
        expect(parseToolJson(replayAfterError)).toMatchObject({
          executed: false,
          error: 'CONFIRMATION_TOKEN_ALREADY_USED',
        });
      } finally {
        await client.close();
        await server.close();
      }
    }
  });
});
