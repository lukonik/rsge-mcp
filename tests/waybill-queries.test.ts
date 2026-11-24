import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, loadConfig } from '../src/config.js';
import { createRsgeServer } from '../src/server.js';
import { errorCodesXml, rsgeResultStatusErrorXml, soapEnvelope, xmlResponse } from './fixtures/soap.js';
import {
  getWaybillResponseXml,
  getWaybillsListResponseXml,
  type WaybillFixture,
} from './fixtures/waybill.js';

function createTestConfig() {
  return loadConfig({
    RSGE_SERVICE_USER: 'demo_user:206322102',
    RSGE_SERVICE_PASSWORD: 'demo-secret-password',
  });
}

function parseToolJson(result: { content: ReadonlyArray<{ type: string; text?: string }> }) {
  const first = result.content[0];
  return JSON.parse(first && first.type === 'text' && first.text ? first.text : '{}') as Record<
    string,
    unknown
  >;
}

const SAMPLE_MULTI_ITEM_WAYBILL: WaybillFixture = {
  id: 1551,
  waybillNumber: '0000014722',
  type: 2,
  status: 1,
  sellerTin: '01001000001',
  sellerName: 'შპს გამყიდველი',
  sellerUnId: 731937,
  buyerTin: '01002000002',
  buyerName: 'შპს მყიდველი',
  checkBuyerTin: 1,
  startAddress: 'თბილისი, რუსთაველის 1',
  endAddress: 'ბათუმი, ჭავჭავაძის 5',
  driverTin: '01003000003',
  driverName: 'გიორგი ბერიძე',
  checkDriverTin: 1,
  carNumber: 'AA123BB',
  transportCost: '15.50',
  transportTypeId: 1,
  transportCostPayer: 2,
  fullAmount: '37.50',
  createDate: '2026-11-24T10:00:00',
  beginDate: '2026-11-24T12:00:00',
  activateDate: '2026-11-24T12:05:00',
  isConfirmed: 0,
  comment: 'საცდელი გადაზიდვა',
  serviceUserId: 20350,
  goods: [
    {
      id: 9001,
      name: 'მინერალური წყალი',
      unitId: 1,
      quantity: '5',
      price: '4.50',
      amount: '22.50',
      barCode: '0012345',
      vatType: 0,
    },
    {
      id: 9002,
      name: 'პური',
      unitId: 99,
      unitText: 'შეკვრა',
      quantity: '10',
      price: '1.50',
      amount: '15.00',
      barCode: '0098765',
      vatType: 2,
    },
  ],
};

describe('Waybill query tools discovery', () => {
  it('registers get_waybill and list_waybills with readOnlyHint: true and Georgian-primary / English-secondary descriptions', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();

      for (const name of ['get_waybill', 'list_waybills']) {
        const tool = tools.find((item) => item.name === name);
        expect(tool).toBeDefined();
        expect(tool?.annotations?.readOnlyHint).toBe(true);
        expect(tool?.annotations?.destructiveHint).toBe(false);
        expect(tool?.description).toMatch(/^[ა-ჰ]/);
        expect(tool?.description).toMatch(/[A-Za-z]{4,}/);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('get_waybill tool', () => {
  it('fetches a Waybill by waybill_id via SOAP get_waybill, preserving leading zeros and parsing multiple Line Items', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(getWaybillResponseXml('get_waybill', SAMPLE_MULTI_ITEM_WAYBILL));
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_waybill', { waybill_id: 1551 });
      expect(result.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0]!;
      expect(req.url).toBe(DEFAULT_RSGE_ENDPOINT);
      const headers = new Headers(req.init?.headers);
      expect(headers.get('soapaction')).toBe('"http://tempuri.org/get_waybill"');
      const body = String(req.init?.body);
      expect(body).toContain('<get_waybill xmlns="http://tempuri.org/">');
      expect(body).toContain('<waybill_id>1551</waybill_id>');

      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        found: true,
        waybill: {
          id: 1551,
          waybillNumber: '0000014722',
          type: 2,
          typeName: 'Delivery with Transportation',
          status: 1,
          statusGeorgian: 'გააქტიურებული',
          statusEnglish: 'Active',
          sellerTin: '01001000001',
          sellerName: 'შპს გამყიდველი',
          sellerUnId: 731937,
          buyerTin: '01002000002',
          buyerName: 'შპს მყიდველი',
          driverTin: '01003000003',
          driverName: 'გიორგი ბერიძე',
          carNumber: 'AA123BB',
          startAddress: 'თბილისი, რუსთაველის 1',
          endAddress: 'ბათუმი, ჭავჭავაძის 5',
          transportCost: 15.5,
          transportTypeId: 1,
          transportTypeName: 'Road / Automobile',
          transportCostPayer: 2,
          fullAmount: 37.5,
          createDate: '2026-11-24T10:00:00',
          beginDate: '2026-11-24T12:00:00',
          activateDate: '2026-11-24T12:05:00',
          confirmationStatus: {
            code: 0,
            georgian: 'დაუდასტურებელი',
            english: 'Pending',
          },
          comment: 'საცდელი გადაზიდვა',
          serviceUserId: 20350,
          lineItems: [
            {
              id: 9001,
              name: 'მინერალური წყალი',
              unitId: 1,
              quantity: 5,
              unitPrice: 4.5,
              amount: 22.5,
              status: 1,
              barCode: '0012345',
              exciseId: 0,
              vatType: 0,
            },
            {
              id: 9002,
              name: 'პური',
              unitId: 99,
              unitText: 'შეკვრა',
              quantity: 10,
              unitPrice: 1.5,
              amount: 15,
              status: 1,
              barCode: '0098765',
              exciseId: 0,
              vatType: 2,
            },
          ],
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('fetches a Waybill by waybill_number via SOAP get_waybill_by_number and normalizes a single Line Item into an array', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const singleItemWaybill: WaybillFixture = {
      id: 2040,
      waybillNumber: '0000099123',
      type: 3,
      status: 2,
      sellerTin: '206322102',
      sellerName: 'შპს მიმწოდებელი',
      buyerTin: '01009008007',
      buyerName: 'ი/მ დავით მაისურაძე',
      fullAmount: '120.00',
      closeDate: '2026-11-24T16:30:00',
      isConfirmed: 1,
      confirmationDate: '2026-11-24T17:00:00',
      goods: [
        {
          id: 5001,
          name: 'საკონსულტაციო კომპლექტი',
          unitId: 1,
          quantity: '2',
          price: '60.00',
          amount: '120.00',
          barCode: '00042',
          vatType: 1,
        },
      ],
    };

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(
        getWaybillResponseXml('get_waybill_by_number', singleItemWaybill),
      );
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_waybill', {
        waybill_number: '0000099123',
      });
      expect(result.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(1);
      const headers = new Headers(capturedRequests[0]!.init?.headers);
      expect(headers.get('soapaction')).toBe(
        '"http://tempuri.org/get_waybill_by_number"',
      );
      const body = String(capturedRequests[0]!.init?.body);
      expect(body).toContain('<get_waybill_by_number xmlns="http://tempuri.org/">');
      expect(body).toContain('<waybill_number>0000099123</waybill_number>');

      const payload = parseToolJson(result);
      const waybill = payload.waybill as Record<string, unknown>;
      expect(waybill.waybillNumber).toBe('0000099123');
      expect(waybill.buyerTin).toBe('01009008007');
      expect(waybill.status).toBe(2);
      expect(waybill.statusGeorgian).toBe('დასრულებული');
      expect(waybill.statusEnglish).toBe('Completed');
      expect(waybill.confirmationStatus).toEqual({
        code: 1,
        georgian: 'დადასტურებული',
        english: 'Confirmed',
      });

      const lineItems = waybill.lineItems as Array<Record<string, unknown>>;
      expect(Array.isArray(lineItems)).toBe(true);
      expect(lineItems).toHaveLength(1);
      expect(lineItems[0]).toMatchObject({
        id: 5001,
        name: 'საკონსულტაციო კომპლექტი',
        barCode: '00042',
        quantity: 2,
        unitPrice: 60,
        amount: 120,
        vatType: 1,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('handles Cancelled Waybill (status -2) with empty GOODS_LIST without treating status as an RS.ge API error', async () => {
    const cancelledWaybill: WaybillFixture = {
      id: 3005,
      waybillNumber: '0000033333',
      type: 2,
      status: -2,
      buyerTin: '206322102',
      fullAmount: '0',
      goods: [],
    };
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(getWaybillResponseXml('get_waybill', cancelledWaybill)),
    );

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_waybill', { waybill_id: 3005 });
      expect(result.isError).toBeFalsy();
      const payload = parseToolJson(result);
      expect(payload.waybill).toMatchObject({
        id: 3005,
        status: -2,
        statusGeorgian: 'გაუქმებული',
        statusEnglish: 'Cancelled',
        lineItems: [],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns WAYBILL_NOT_FOUND error when RS.ge returns an empty WAYBILL element', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(getWaybillResponseXml('get_waybill', null)),
    );

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_waybill', { waybill_id: 999999 });
      expect(result.isError).toBe(true);
      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        found: false,
        waybillId: 999999,
        error: 'WAYBILL_NOT_FOUND',
      });
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('validates that exactly one of waybill_id or waybill_number is provided without calling RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(client.callToolRaw('get_waybill', {})).rejects.toThrow(
        /მიუთითეთ.*waybill_id.*waybill_number/i,
      );
      await expect(
        client.callToolRaw('get_waybill', {
          waybill_id: 1551,
          waybill_number: '0000014722',
        }),
      ).rejects.toThrow(/მიუთითეთ.*waybill_id.*waybill_number/i);
      await expect(
        client.callToolRaw('get_waybill', { waybill_id: 0 }),
      ).rejects.toThrow(/ზედნადების ID.*waybill_id/i);
      await expect(
        client.callToolRaw('get_waybill', { waybill_number: '   ' }),
      ).rejects.toThrow(/ზედნადების ნომერი.*waybill_number/i);

      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('automatically translates negative RS.ge error codes on get_waybill without leaking credentials', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybill"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_waybill', -101));
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
      const result = await client.callToolRaw('get_waybill', { waybill_id: 7777 });
      expect(result.isError).toBe(true);
      const rawText =
        result.content[0]?.type === 'text' ? result.content[0].text : '';
      expect(rawText).not.toContain('demo_user:206322102');
      expect(rawText).not.toContain('demo-secret-password');

      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        error: 'RSGE_API_ERROR',
        code: -101,
        operation: 'get_waybill',
        waybillId: 7777,
        georgianText: 'ზედნადები არ ეკუთვნის გადამხდელს',
        knownCode: true,
      });
      expect(String(payload.englishText)).toMatch(/[A-Za-z]{4,}/);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('handles self-closing empty get_waybillResult gracefully as WAYBILL_NOT_FOUND', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(
        soapEnvelope(
          `<get_waybill_by_numberResponse xmlns="http://tempuri.org/">` +
            `<get_waybill_by_numberResult />` +
            `</get_waybill_by_numberResponse>`,
        ),
      ),
    );

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('get_waybill', {
        waybill_number: '0000000000',
      });
      expect(result.isError).toBe(true);
      expect(parseToolJson(result)).toMatchObject({
        error: 'WAYBILL_NOT_FOUND',
        found: false,
        waybillNumber: '0000000000',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('list_waybills tool', () => {
  it('queries outgoing Seller Waybills via get_waybills with exact 19-param WSDL order, xsi:nil for unset nillable params, and normalized dates', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const outgoingRows: WaybillFixture[] = [
      {
        id: 1551,
        waybillNumber: '0000014722',
        type: 2,
        status: 1,
        buyerTin: '01002000002',
        buyerName: 'შპს ალფა',
        fullAmount: '250.75',
        carNumber: 'AA123BB',
        driverTin: '01003000003',
        createDate: '2026-11-20T09:15:00',
        beginDate: '2026-11-20T10:00:00',
        isConfirmed: 0,
      },
      {
        id: 1552,
        waybillNumber: '0000014723',
        type: 2,
        status: 2,
        buyerTin: '01002000002',
        buyerName: 'შპს ალფა',
        fullAmount: '99.00',
        createDate: '2026-11-22T14:30:00',
        closeDate: '2026-11-22T18:00:00',
        isConfirmed: 1,
      },
    ];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(getWaybillsListResponseXml('get_waybills', outgoingRows));
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('list_waybills', {
        direction: 'outgoing',
        waybill_types: [1, 2],
        statuses: [1, 2],
        counterparty_tin: '01002000002',
        waybill_number: '0000014722',
        create_date_from: '2026-11-01',
        create_date_to: '2026-11-24',
      });
      expect(result.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0]!;
      expect(req.url).toBe(DEFAULT_RSGE_ENDPOINT);
      const headers = new Headers(req.init?.headers);
      expect(headers.get('soapaction')).toBe('"http://tempuri.org/get_waybills"');

      const body = String(req.init?.body);
      expect(body).toContain('<get_waybills xmlns="http://tempuri.org/">');
      expect(body).toContain('<itypes>,1,2,</itypes>');
      expect(body).toContain('<buyer_tin>01002000002</buyer_tin>');
      expect(body).not.toContain('<seller_tin>');
      expect(body).toContain('<statuses>,1,2,</statuses>');
      expect(body).toContain('<create_date_s>2026-11-01T00:00:00</create_date_s>');
      expect(body).toContain('<create_date_e>2026-11-24T23:59:59</create_date_e>');
      expect(body).toContain('<waybill_number>0000014722</waybill_number>');

      // All unset nillable dateTime and decimal fields MUST use xsi:nil="true" (never empty tags)
      for (const nillableField of [
        'begin_date_s',
        'begin_date_e',
        'delivery_date_s',
        'delivery_date_e',
        'full_amount',
        'close_date_s',
        'close_date_e',
      ]) {
        expect(body).toContain(`<${nillableField} xsi:nil="true" />`);
        expect(body).not.toContain(`<${nillableField}></${nillableField}>`);
      }

      // Verify exact 19-parameter WSDL order
      const expectedParamOrder = [
        '<su>',
        '<sp>',
        '<itypes>',
        '<buyer_tin>',
        '<statuses>',
        '<car_number>',
        '<begin_date_s ',
        '<begin_date_e ',
        '<create_date_s>',
        '<create_date_e>',
        '<driver_tin>',
        '<delivery_date_s ',
        '<delivery_date_e ',
        '<full_amount ',
        '<waybill_number>',
        '<close_date_s ',
        '<close_date_e ',
        '<s_user_ids>',
        '<comment>',
      ];
      let prevIdx = -1;
      for (const marker of expectedParamOrder) {
        const idx = body.indexOf(marker);
        expect(idx, `Expected ${marker} to be present in SOAP body`).toBeGreaterThan(
          prevIdx,
        );
        prevIdx = idx;
      }

      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        direction: 'outgoing',
        operation: 'get_waybills',
        count: 2,
      });
      const items = payload.items as Array<Record<string, unknown>>;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        id: 1551,
        waybillNumber: '0000014722',
        buyerTin: '01002000002',
        driverTin: '01003000003',
        status: 1,
        statusGeorgian: 'გააქტიურებული',
        statusEnglish: 'Active',
        fullAmount: 250.75,
      });
      expect(items[1]).toMatchObject({
        id: 1552,
        waybillNumber: '0000014723',
        status: 2,
        statusGeorgian: 'დასრულებული',
        statusEnglish: 'Completed',
        fullAmount: 99,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('queries incoming Buyer Waybills via get_buyer_waybills with seller_tin and normalizes a single WAYBILL row into an array', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const incomingRow: WaybillFixture = {
      id: 4201,
      waybillNumber: '0000088001',
      type: 2,
      status: 1,
      sellerTin: '01005550001',
      sellerName: 'შპს მომწოდებელი',
      fullAmount: '540.25',
      beginDate: '2026-11-23T08:00:00',
      isConfirmed: 0,
    };

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(
        getWaybillsListResponseXml('get_buyer_waybills', [incomingRow]),
      );
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const result = await client.callToolRaw('list_waybills', {
        direction: 'incoming',
        counterparty_tin: '01005550001',
        statuses: [1],
        begin_date_from: '2026-11-23T00:00:00',
        begin_date_to: '2026-11-24T12:00:00',
        full_amount: 540.25,
      });
      expect(result.isError).toBeFalsy();

      expect(capturedRequests).toHaveLength(1);
      const headers = new Headers(capturedRequests[0]!.init?.headers);
      expect(headers.get('soapaction')).toBe(
        '"http://tempuri.org/get_buyer_waybills"',
      );
      const body = String(capturedRequests[0]!.init?.body);
      expect(body).toContain('<get_buyer_waybills xmlns="http://tempuri.org/">');
      expect(body).toContain('<seller_tin>01005550001</seller_tin>');
      expect(body).not.toContain('<buyer_tin>');
      expect(body).toContain('<statuses>,1,</statuses>');
      expect(body).toContain('<begin_date_s>2026-11-23T00:00:00</begin_date_s>');
      expect(body).toContain('<begin_date_e>2026-11-24T12:00:00</begin_date_e>');
      expect(body).toContain('<full_amount>540.25</full_amount>');
      expect(body).toContain('<create_date_s xsi:nil="true" />');
      expect(body).toContain('<create_date_e xsi:nil="true" />');

      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        direction: 'incoming',
        operation: 'get_buyer_waybills',
        count: 1,
      });
      const items = payload.items as Array<Record<string, unknown>>;
      expect(Array.isArray(items)).toBe(true);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 4201,
        waybillNumber: '0000088001',
        sellerTin: '01005550001',
        sellerName: 'შპს მომწოდებელი',
        fullAmount: 540.25,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('handles empty WAYBILL_LIST results cleanly for both outgoing and incoming queries', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybills"') {
        return xmlResponse(getWaybillsListResponseXml('get_waybills', []));
      }
      if (soapAction === '"http://tempuri.org/get_buyer_waybills"') {
        return xmlResponse(getWaybillsListResponseXml('get_buyer_waybills', []));
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
      const outgoing = await client.callToolRaw('list_waybills', {
        direction: 'outgoing',
      });
      expect(outgoing.isError).toBeFalsy();
      expect(parseToolJson(outgoing)).toEqual({
        direction: 'outgoing',
        operation: 'get_waybills',
        count: 0,
        items: [],
      });

      const incoming = await client.callToolRaw('list_waybills', {
        direction: 'incoming',
      });
      expect(incoming.isError).toBeFalsy();
      expect(parseToolJson(incoming)).toEqual({
        direction: 'incoming',
        operation: 'get_buyer_waybills',
        count: 0,
        items: [],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects invalid list_waybills arguments (bad direction, malformed date, inverted date range, invalid TIN) before calling RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(
        client.callToolRaw('list_waybills', { direction: 'both' }),
      ).rejects.toThrow(/მიმართულება.*direction/i);

      await expect(
        client.callToolRaw('list_waybills', {
          direction: 'outgoing',
          create_date_from: '24/11/2026',
        }),
      ).rejects.toThrow(/თარიღის ფორმატი.*YYYY-MM-DD/i);

      await expect(
        client.callToolRaw('list_waybills', {
          direction: 'outgoing',
          create_date_from: '2026-02-30',
        }),
      ).rejects.toThrow(/კალენდარული.*calendar date/i);

      await expect(
        client.callToolRaw('list_waybills', {
          direction: 'outgoing',
          create_date_from: '2026-11-25',
          create_date_to: '2026-11-20',
        }),
      ).rejects.toThrow(/საწყისი თარიღი.*create_date_from/i);

      await expect(
        client.callToolRaw('list_waybills', {
          direction: 'incoming',
          counterparty_tin: '12345',
        }),
      ).rejects.toThrow(/საიდენტიფიკაციო კოდი.*TIN/i);

      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('automatically translates RS.ge error codes on list_waybills', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_buyer_waybills"') {
        return xmlResponse(rsgeResultStatusErrorXml('get_buyer_waybills', -100));
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
      const result = await client.callToolRaw('list_waybills', {
        direction: 'incoming',
      });
      expect(result.isError).toBe(true);
      const payload = parseToolJson(result);
      expect(payload).toMatchObject({
        error: 'RSGE_API_ERROR',
        code: -100,
        operation: 'get_buyer_waybills',
        direction: 'incoming',
        georgianText: 'სერვისის მომხმარებლის სახელი ან პაროლი არასწორია',
        knownCode: true,
      });
      expect(String(payload.hint)).toContain('IP');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
