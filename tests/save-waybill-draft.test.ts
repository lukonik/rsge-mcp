import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, createRsgeServer } from '../src/index.js';
import { createTestConfig, parseToolJson } from './fixtures/mcp.js';
import {
  checkServiceUserInvalidXml,
  checkServiceUserSuccessXml,
  errorCodesXml,
  parseCapturedXml,
  soapEnvelope,
  xmlResponse,
} from './fixtures/soap.js';

function saveWaybillResultXml(options: {
  status?: number;
  id?: number;
  waybillNumber?: string;
  goods?: ReadonlyArray<{ id?: number; error?: number; name?: string }>;
}): string {
  const status = options.status ?? 0;
  const idTag = options.id !== undefined ? `<ID>${options.id}</ID>` : '';
  const numberTag =
    options.waybillNumber !== undefined
      ? `<WAYBILL_NUMBER>${options.waybillNumber}</WAYBILL_NUMBER>`
      : '';
  const goodsXml =
    options.goods !== undefined
      ? `<GOODS_LIST>${options.goods
          .map(
            (g) =>
              `<GOODS>` +
              `${g.id !== undefined ? `<ID>${g.id}</ID>` : ''}` +
              `${g.error !== undefined ? `<ERROR>${g.error}</ERROR>` : ''}` +
              `${g.name !== undefined ? `<W_NAME>${g.name}</W_NAME>` : ''}` +
              `</GOODS>`,
          )
          .join('')}</GOODS_LIST>`
      : '';

  return soapEnvelope(
    `<save_waybillResponse xmlns="http://tempuri.org/">` +
      `<save_waybillResult>` +
      `<RESULT xmlns="">` +
      `<STATUS>${status}</STATUS>` +
      `${idTag}` +
      `${numberTag}` +
      `${goodsXml}` +
      `</RESULT>` +
      `</save_waybillResult>` +
      `</save_waybillResponse>`,
  );
}

describe('save_waybill_draft tool registration', () => {
  it('registers save_waybill_draft with readOnlyHint: false, destructiveHint: false, Georgian-primary description, and no confirmationToken', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();
      const tool = tools.find((item) => item.name === 'save_waybill_draft');

      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(false);
      expect(tool?.annotations?.destructiveHint).toBe(false);
      expect(tool?.description).toMatch(/^[ა-ჰ]/);
      expect(tool?.description).toMatch(/[A-Za-z]{4,}/);

      // Exempt from confirmation token per ADR-0002
      const properties = (tool?.inputSchema as { properties?: Record<string, unknown> })
        ?.properties;
      expect(properties).toBeDefined();
      expect(properties).not.toHaveProperty('confirmationToken');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('save_waybill_draft execution via MCP protocol and stubbed fetch', () => {
  it('creates a new Draft Waybill with exact nested RS.ge XML tags, lazy seller identity, and server-computed totals', async () => {
    const capturedRequests: Array<{
      url: string;
      soapAction: string;
      body: string;
    }> = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      const body = String(init?.body ?? '');
      capturedRequests.push({ url: String(input), soapAction, body });

      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        return xmlResponse(
          saveWaybillResultXml({
            status: 0,
            id: 1551,
            goods: [{ id: 9001, error: 0, name: 'მინერალური წყალი' }],
          }),
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        buyerName: 'შპს მაგალითი',
        startAddress: 'თბილისი, რუსთაველის 1',
        endAddress: 'ბათუმი, ჭავჭავაძის 5',
        driverTin: '01001000000',
        driverName: 'გიორგი ბერიძე',
        vehicleNumber: 'AA123BB',
        transportTypeId: 1,
        transportCost: 15.5,
        transportCostPayer: 2,
        beginDate: '2026-11-24T12:00:00',
        comment: 'პირველი მიწოდება',
        lineItems: [
          {
            name: 'მინერალური წყალი',
            unitId: 1,
            quantity: 5,
            unitPrice: 4.5,
            vatType: 0,
            barcode: 'SKU001',
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      expect(capturedRequests).toHaveLength(2);
      expect(capturedRequests[0]?.soapAction).toBe(
        '"http://tempuri.org/chek_service_user"',
      );

      const saveReq = capturedRequests[1]!;
      expect(saveReq.url).toBe(DEFAULT_RSGE_ENDPOINT);
      expect(saveReq.soapAction).toBe('"http://tempuri.org/save_waybill"');

      // Exact nested <WAYBILL> XML (not escaped) and RS.ge wire spellings
      expect(saveReq.body).toContain('<save_waybill xmlns="http://tempuri.org/">');
      expect(saveReq.body).toContain('<waybill><WAYBILL>');
      expect(saveReq.body).toContain('<SUB_WAYBILLS></SUB_WAYBILLS>');
      expect(saveReq.body).toContain(
        '<GOODS_LIST><GOODS>' +
          '<ID>0</ID>' +
          '<W_NAME>მინერალური წყალი</W_NAME>' +
          '<UNIT_ID>1</UNIT_ID>' +
          '<UNIT_TXT></UNIT_TXT>' +
          '<QUANTITY>5</QUANTITY>' +
          '<PRICE>4.50</PRICE>' +
          '<STATUS>1</STATUS>' +
          '<AMOUNT>22.50</AMOUNT>' +
          '<BAR_CODE>SKU001</BAR_CODE>' +
          '<A_ID>0</A_ID>' +
          '<VAT_TYPE>0</VAT_TYPE>' +
          '</GOODS></GOODS_LIST>',
      );
      expect(saveReq.body).toContain('<ID>0</ID><TYPE>2</TYPE>');
      expect(saveReq.body).toContain('<BUYER_TIN>206322102</BUYER_TIN>');
      expect(saveReq.body).toContain('<CHEK_BUYER_TIN>1</CHEK_BUYER_TIN>');
      expect(saveReq.body).toContain('<BUYER_NAME>შპს მაგალითი</BUYER_NAME>');
      expect(saveReq.body).toContain(
        '<START_ADDRESS>თბილისი, რუსთაველის 1</START_ADDRESS>',
      );
      expect(saveReq.body).toContain(
        '<END_ADDRESS>ბათუმი, ჭავჭავაძის 5</END_ADDRESS>',
      );
      expect(saveReq.body).toContain('<DRIVER_TIN>01001000000</DRIVER_TIN>');
      expect(saveReq.body).toContain('<CHEK_DRIVER_TIN>1</CHEK_DRIVER_TIN>');
      expect(saveReq.body).toContain('<DRIVER_NAME>გიორგი ბერიძე</DRIVER_NAME>');
      expect(saveReq.body).toContain('<TRANSPORT_COAST>15.50</TRANSPORT_COAST>');
      expect(saveReq.body).toContain('<STATUS>0</STATUS>');
      expect(saveReq.body).toContain('<SELER_UN_ID>731937</SELER_UN_ID>');
      expect(saveReq.body).toContain('<FULL_AMOUNT>22.50</FULL_AMOUNT>');
      expect(saveReq.body).toContain('<CAR_NUMBER>AA123BB</CAR_NUMBER>');
      expect(saveReq.body).toContain('<S_USER_ID>20350</S_USER_ID>');
      expect(saveReq.body).toContain(
        '<BEGIN_DATE>2026-11-24T12:00:00</BEGIN_DATE>',
      );
      expect(saveReq.body).toContain('<TRAN_COST_PAYER>2</TRAN_COST_PAYER>');
      expect(saveReq.body).toContain('<TRANS_ID>1</TRANS_ID>');
      expect(saveReq.body).toContain('<TRANS_TXT></TRANS_TXT>');
      expect(saveReq.body).toContain('<COMMENT>პირველი მიწოდება</COMMENT>');
      expect(saveReq.body).toContain('<CATEGORY>0</CATEGORY><IS_MED>0</IS_MED>');

      const textBlock = result.content[0];
      expect(textBlock?.type).toBe('text');
      const payload = JSON.parse(
        textBlock?.type === 'text' ? textBlock.text : '{}',
      ) as Record<string, unknown>;

      expect(payload.waybillId).toBe(1551);
      expect(payload.waybillNumber).toBeNull();
      expect(payload.status).toBe(0);
      expect(payload.isUpdate).toBe(false);
      expect(payload.fullAmount).toBe(22.5);
      expect(payload.fullAmountFormatted).toBe('22.50');
      expect(payload.lineItems).toEqual([
        {
          id: 9001,
          name: 'მინერალური წყალი',
          unitId: 1,
          quantity: 5,
          unitPrice: 4.5,
          amount: 22.5,
          amountFormatted: '22.50',
          vatType: 0,
          barcode: 'SKU001',
          status: 1,
        },
      ]);
      expect(String(payload.message)).toMatch(/[ა-ჰ]/);
      expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('computes Line Item AMOUNT and Waybill FULL_AMOUNT server-side without IEEE-754 floating-point drift', async () => {
    let capturedSaveBody = '';
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        capturedSaveBody = String(init?.body ?? '');
        return xmlResponse(
          saveWaybillResultXml({
            status: 0,
            id: 2002,
            goods: [
              { id: 101, error: 0 },
              { id: 102, error: 0 },
              { id: 103, error: 0 },
              { id: 104, error: 0 },
              { id: 105, error: 0 },
            ],
          }),
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'რუსთავი',
        lineItems: [
          // 0.1 + 0.2 drift case
          { name: 'პოზიცია 1', unitId: 1, quantity: 1, unitPrice: 0.1 },
          { name: 'პოზიცია 2', unitId: 1, quantity: 1, unitPrice: 0.2 },
          // 7 * 0.14 = 0.9800000000000001 in binary float
          { name: 'პოზიცია 3', unitId: 1, quantity: 7, unitPrice: 0.14 },
          // 3 * 1.005 = 3.0149999999999997 in binary float; exact 3.015 rounds half-up to 3.02
          { name: 'პოზიცია 4', unitId: 1, quantity: 3, unitPrice: 1.005 },
          // 3-decimal unit price preserved in <PRICE>
          { name: 'პოზიცია 5', unitId: 2, quantity: 8, unitPrice: 0.125 },
        ],
      });

      expect(result.isError).toBeFalsy();

      // Exact decimal strings in XML with zero float artifacts
      expect(capturedSaveBody).toContain('<PRICE>0.10</PRICE><STATUS>1</STATUS><AMOUNT>0.10</AMOUNT>');
      expect(capturedSaveBody).toContain('<PRICE>0.20</PRICE><STATUS>1</STATUS><AMOUNT>0.20</AMOUNT>');
      expect(capturedSaveBody).toContain('<QUANTITY>7</QUANTITY><PRICE>0.14</PRICE><STATUS>1</STATUS><AMOUNT>0.98</AMOUNT>');
      expect(capturedSaveBody).toContain('<QUANTITY>3</QUANTITY><PRICE>1.005</PRICE><STATUS>1</STATUS><AMOUNT>3.02</AMOUNT>');
      expect(capturedSaveBody).toContain('<QUANTITY>8</QUANTITY><PRICE>0.125</PRICE><STATUS>1</STATUS><AMOUNT>1.00</AMOUNT>');
      // 0.10 + 0.20 + 0.98 + 3.02 + 1.00 = 5.30
      expect(capturedSaveBody).toContain('<FULL_AMOUNT>5.30</FULL_AMOUNT>');
      expect(capturedSaveBody).not.toMatch(/0000000|9999999/);

      const payload = JSON.parse(
        result.content[0]?.type === 'text' ? result.content[0].text : '{}',
      ) as {
        fullAmount: number;
        fullAmountFormatted: string;
        lineItems: Array<{ amount: number; amountFormatted: string }>;
      };

      expect(payload.fullAmount).toBe(5.3);
      expect(payload.fullAmountFormatted).toBe('5.30');
      expect(payload.lineItems.map((i) => i.amountFormatted)).toEqual([
        '0.10',
        '0.20',
        '0.98',
        '3.02',
        '1.00',
      ]);
      expect(payload.lineItems.map((i) => i.amount)).toEqual([
        0.1,
        0.2,
        0.98,
        3.02,
        1,
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('preserves Georgian UTF-8 characters and properly escapes XML special characters in nested WAYBILL payload', async () => {
    let capturedSaveBody = '';
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        capturedSaveBody = String(init?.body ?? '');
        return xmlResponse(saveWaybillResultXml({ status: 0, id: 2003 }));
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        buyerName: 'შპს "ალფა & ბეტა" <თბილისი>',
        startAddress: `თბილისი, რუსთაველის 1 & 'კორპუსი 2'`,
        endAddress: 'ბათუმი <პორტი>',
        comment: `სასწრაფო <მიწოდება> & "შემოწმება" '100%'`,
        lineItems: [
          {
            name: `ღვინო "საფერავი" <0.75ლ> & 'ქვევრი'`,
            unitId: 99,
            unitText: 'ყუთი <6 ც.> & "შეფუთვა"',
            quantity: 2,
            unitPrice: 25,
            vatType: 0,
            barcode: 'A&B<1>',
          },
        ],
      });

      expect(result.isError).toBeFalsy();
      expect(capturedSaveBody).toContain(
        '<BUYER_NAME>შპს &quot;ალფა &amp; ბეტა&quot; &lt;თბილისი&gt;</BUYER_NAME>',
      );
      expect(capturedSaveBody).toContain(
        '<START_ADDRESS>თბილისი, რუსთაველის 1 &amp; &apos;კორპუსი 2&apos;</START_ADDRESS>',
      );
      expect(capturedSaveBody).toContain(
        '<END_ADDRESS>ბათუმი &lt;პორტი&gt;</END_ADDRESS>',
      );
      expect(capturedSaveBody).toContain(
        '<W_NAME>ღვინო &quot;საფერავი&quot; &lt;0.75ლ&gt; &amp; &apos;ქვევრი&apos;</W_NAME>',
      );
      expect(capturedSaveBody).toContain(
        '<UNIT_ID>99</UNIT_ID><UNIT_TXT>ყუთი &lt;6 ც.&gt; &amp; &quot;შეფუთვა&quot;</UNIT_TXT>',
      );
      expect(capturedSaveBody).toContain('<BAR_CODE>A&amp;B&lt;1&gt;</BAR_CODE>');
      expect(capturedSaveBody).toContain(
        '<COMMENT>სასწრაფო &lt;მიწოდება&gt; &amp; &quot;შემოწმება&quot; &apos;100%&apos;</COMMENT>',
      );

      // Verify the escaped SOAP envelope round-trips cleanly through XML parsing
      const reparsed = parseCapturedXml(capturedSaveBody) as {
        Envelope: {
          Body: {
            save_waybill: {
              waybill: {
                WAYBILL: {
                  BUYER_NAME: string;
                  GOODS_LIST: { GOODS: { W_NAME: string; UNIT_TXT: string } };
                };
              };
            };
          };
        };
      };
      const waybillNode = reparsed.Envelope.Body.save_waybill.waybill.WAYBILL;
      expect(waybillNode.BUYER_NAME).toBe('შპს "ალფა & ბეტა" <თბილისი>');
      expect(waybillNode.GOODS_LIST.GOODS.W_NAME).toBe(
        `ღვინო "საფერავი" <0.75ლ> & 'ქვევრი'`,
      );
      expect(waybillNode.GOODS_LIST.GOODS.UNIT_TXT).toBe(
        'ყუთი <6 ც.> & "შეფუთვა"',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('updates an existing Draft Waybill, excludes deleted Line Items (status=-1) from FULL_AMOUNT, preserves WAYBILL_NUMBER, and caches seller identity', async () => {
    let checkServiceUserCalls = 0;
    const saveBodies: string[] = [];

    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        checkServiceUserCalls += 1;
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        saveBodies.push(String(init?.body ?? ''));
        if (saveBodies.length === 1) {
          return xmlResponse(
            saveWaybillResultXml({
              status: 0,
              id: 1551,
              goods: [{ id: 9001, error: 0 }],
            }),
          );
        }
        return xmlResponse(
          saveWaybillResultXml({
            status: 0,
            id: 1551,
            waybillNumber: '0000014722',
            goods: [
              { id: 9001, error: 0, name: 'განახლებული საქონელი' },
              { id: 9002, error: 0, name: 'წასაშლელი პოზიცია' },
            ],
          }),
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
      // First call creates draft -> fetches chek_service_user once
      const created = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'გორი',
        lineItems: [{ name: 'საწყისი', unitId: 1, quantity: 1, unitPrice: 10 }],
      });
      expect(created.isError).toBeFalsy();

      // Second call updates existing draft 1551 -> reuses cached seller identity
      const updated = await client.callToolRaw('save_waybill_draft', {
        waybillId: 1551,
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'გორი',
        lineItems: [
          {
            id: 9001,
            name: 'განახლებული საქონელი',
            unitId: 1,
            quantity: 4,
            unitPrice: 12.5,
            status: 1,
          },
          {
            id: 9002,
            name: 'წასაშლელი პოზიცია',
            unitId: 1,
            quantity: 10,
            unitPrice: 99,
            status: -1,
          },
        ],
      });

      expect(updated.isError).toBeFalsy();
      expect(checkServiceUserCalls).toBe(1);
      expect(saveBodies).toHaveLength(2);

      const updateXml = saveBodies[1]!;
      expect(updateXml).toContain('<ID>1551</ID><TYPE>2</TYPE>');
      expect(updateXml).toContain('<STATUS>0</STATUS>');
      expect(updateXml).toContain('<ID>9001</ID><W_NAME>განახლებული საქონელი</W_NAME>');
      expect(updateXml).toContain('<ID>9002</ID><W_NAME>წასაშლელი პოზიცია</W_NAME>');
      expect(updateXml).toContain('<STATUS>-1</STATUS>');
      // Only active item (4 * 12.50 = 50.00) counts toward FULL_AMOUNT
      expect(updateXml).toContain('<FULL_AMOUNT>50.00</FULL_AMOUNT>');

      const payload = JSON.parse(
        updated.content[0]?.type === 'text' ? updated.content[0].text : '{}',
      ) as Record<string, unknown>;

      expect(payload.waybillId).toBe(1551);
      expect(payload.waybillNumber).toBe('0000014722');
      expect(payload.isUpdate).toBe(true);
      expect(payload.fullAmount).toBe(50);
      expect(payload.fullAmountFormatted).toBe('50.00');
      expect(String(payload.message)).toContain('1551');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('applies Type 3 (without transport) defaults and supports foreign Buyer/Driver flags and custom Transport Type 4', async () => {
    const saveBodies: string[] = [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        saveBodies.push(String(init?.body ?? ''));
        return xmlResponse(saveWaybillResultXml({ status: 0, id: 3001 }));
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
      // Type 1: Internal Transfer (no buyerTin, requires startAddress & endAddress)
      const type1 = await client.callToolRaw('save_waybill_draft', {
        waybillType: 1,
        startAddress: 'თბილისი, საწყობი 1',
        endAddress: 'თბილისი, ფილიალი 2',
        lineItems: [{ name: 'შიდა გადაზიდვის ტვირთი', unitId: 1, quantity: 3, unitPrice: 10 }],
      });
      expect(type1.isError).toBeFalsy();
      expect(saveBodies[0]).toContain('<TYPE>1</TYPE>');
      expect(saveBodies[0]).toContain('<BUYER_TIN></BUYER_TIN>');
      expect(saveBodies[0]).toContain('<START_ADDRESS>თბილისი, საწყობი 1</START_ADDRESS>');
      expect(saveBodies[0]).toContain('<END_ADDRESS>თბილისი, ფილიალი 2</END_ADDRESS>');
      expect(saveBodies[0]).toContain('<TRANS_ID>1</TRANS_ID>');

      // Type 3: without transport -> TRANS_ID defaults to 0, TRANSPORT_COAST = 0, TRAN_COST_PAYER = ""
      const type3 = await client.callToolRaw('save_waybill_draft', {
        waybillType: 3,
        buyerTin: '206322102',
        lineItems: [{ name: 'კონსულტაციის მასალა', unitId: 1, quantity: 1, unitPrice: 100 }],
      });
      expect(type3.isError).toBeFalsy();
      expect(saveBodies[1]).toContain('<TYPE>3</TYPE>');
      expect(saveBodies[1]).toContain('<TRANSPORT_COAST>0</TRANSPORT_COAST>');
      expect(saveBodies[1]).toContain('<TRAN_COST_PAYER></TRAN_COST_PAYER>');
      expect(saveBodies[1]).toContain('<TRANS_ID>0</TRANS_ID>');

      // Foreign Buyer + foreign Driver + custom Transport Type 4
      const foreign = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: 'DE123456789',
        buyerIsGeorgian: false,
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        driverTin: 'PASS98765',
        driverIsGeorgian: false,
        transportTypeId: 4,
        transportText: 'საზღვაო კონტეინერი',
        transportCostPayer: 1,
        lineItems: [{ name: 'საექსპორტო ტვირთი', unitId: 1, quantity: 2, unitPrice: 50, vatType: 1 }],
      });
      expect(foreign.isError).toBeFalsy();
      expect(saveBodies[2]).toContain('<BUYER_TIN>DE123456789</BUYER_TIN><CHEK_BUYER_TIN>0</CHEK_BUYER_TIN>');
      expect(saveBodies[2]).toContain('<DRIVER_TIN>PASS98765</DRIVER_TIN><CHEK_DRIVER_TIN>0</CHEK_DRIVER_TIN>');
      expect(saveBodies[2]).toContain('<TRAN_COST_PAYER>1</TRAN_COST_PAYER>');
      expect(saveBodies[2]).toContain('<TRANS_ID>4</TRANS_ID><TRANS_TXT>საზღვაო კონტეინერი</TRANS_TXT>');
      expect(saveBodies[2]).toContain('<VAT_TYPE>1</VAT_TYPE>');
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('save_waybill_draft Zod validation failures', () => {
  it('rejects invalid Draft Waybill inputs via Zod before making any RS.ge network call', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    const validBase = {
      waybillType: 2,
      buyerTin: '206322102',
      startAddress: 'თბილისი, რუსთაველის 1',
      endAddress: 'ბათუმი, ჭავჭავაძის 5',
      lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: 10 }],
    };

    try {
      // Empty lineItems
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, lineItems: [] }),
      ).rejects.toThrow();

      // Out-of-scope Sub-waybill (waybillType: 6) per ADR-0001
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, waybillType: 6 }),
      ).rejects.toThrow();

      // Invalid waybillType
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, waybillType: 9 }),
      ).rejects.toThrow();

      // Invalid transportTypeId (999 or out of 1..7)
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, transportTypeId: 999 }),
      ).rejects.toThrow();

      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, transportTypeId: 8 }),
      ).rejects.toThrow();

      // transportTypeId: 0 is rejected on transport Waybill Types (1, 2, 4, 5)
      for (const transportWaybillType of [1, 2, 4, 5]) {
        const baseForType =
          transportWaybillType === 1
            ? {
                waybillType: 1,
                startAddress: validBase.startAddress,
                endAddress: validBase.endAddress,
                lineItems: validBase.lineItems,
              }
            : { ...validBase, waybillType: transportWaybillType };
        await expect(
          client.callToolRaw('save_waybill_draft', {
            ...baseForType,
            transportTypeId: 0,
          }),
        ).rejects.toThrow();
      }

      // Non-zero transportTypeId is rejected on Type 3 (without transport)
      await expect(
        client.callToolRaw('save_waybill_draft', {
          waybillType: 3,
          buyerTin: '206322102',
          transportTypeId: 1,
          lineItems: validBase.lineItems,
        }),
      ).rejects.toThrow();

      // Missing buyerTin on Waybill Types 2, 3, 5
      for (const buyerRequiredType of [2, 3, 5]) {
        const { buyerTin: _omitted, ...withoutBuyerTin } = validBase;
        await expect(
          client.callToolRaw('save_waybill_draft', {
            ...withoutBuyerTin,
            waybillType: buyerRequiredType,
          }),
        ).rejects.toThrow();
      }

      // Disallowed buyerTin on Type 1 (Internal Transfer)
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          waybillType: 1,
          buyerTin: '206322102',
        }),
      ).rejects.toThrow();

      // Missing startAddress or endAddress on transport Waybill Types 1 and 2
      for (const addressRequiredType of [1, 2]) {
        const typeBase =
          addressRequiredType === 1
            ? {
                waybillType: 1,
                startAddress: validBase.startAddress,
                endAddress: validBase.endAddress,
                lineItems: validBase.lineItems,
              }
            : validBase;

        const { startAddress: _noStart, ...missingStart } = typeBase;
        await expect(
          client.callToolRaw('save_waybill_draft', missingStart),
        ).rejects.toThrow();

        const { endAddress: _noEnd, ...missingEnd } = typeBase;
        await expect(
          client.callToolRaw('save_waybill_draft', missingEnd),
        ).rejects.toThrow();
      }

      // Non-positive quantity
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 0, unitPrice: 10 }],
        }),
      ).rejects.toThrow();

      // Negative unitPrice
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: -5 }],
        }),
      ).rejects.toThrow();

      // Malformed Georgian Buyer TIN (not 9 or 11 digits)
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, buyerTin: '12345' }),
      ).rejects.toThrow();

      // Malformed Georgian Driver TIN (not 11 digits)
      await expect(
        client.callToolRaw('save_waybill_draft', { ...validBase, driverTin: '123456789' }),
      ).rejects.toThrow();

      // Missing unitText when unitId === 99
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          lineItems: [{ name: 'ტესტი', unitId: 99, quantity: 1, unitPrice: 10 }],
        }),
      ).rejects.toThrow();

      // Missing transportText when transportTypeId === 4
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          transportTypeId: 4,
        }),
      ).rejects.toThrow();

      // Invalid beginDate format
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          beginDate: '24-11-2026 12:00',
        }),
      ).rejects.toThrow();

      // Impossible calendar dates on beginDate and deliveryDate
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          beginDate: '2026-02-30T12:00:00',
        }),
      ).rejects.toThrow();

      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          deliveryDate: '2026-13-01T10:00:00',
        }),
      ).rejects.toThrow();

      // Deletion status (-1) without existing Line Item ID
      await expect(
        client.callToolRaw('save_waybill_draft', {
          ...validBase,
          lineItems: [
            { name: 'აქტიური', unitId: 1, quantity: 1, unitPrice: 10, status: 1 },
            { name: 'წასაშლელი', unitId: 1, quantity: 1, unitPrice: 10, status: -1 },
          ],
        }),
      ).rejects.toThrow();

      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('save_waybill_draft RS.ge error translation', () => {
  it('translates top-level negative RS.ge STATUS codes into Georgian + English', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        return xmlResponse(saveWaybillResultXml({ status: -1001, id: 0 }));
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: 10 }],
      });

      expect(result.isError).toBe(true);
      const payload = parseToolJson(result);

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-1001);
      expect(payload.operation).toBe('save_waybill');
      expect(payload.georgianText).toBe('ზედნადების ტიპი არასწორია');
      expect(String(payload.englishText)).toMatch(/Waybill Type/i);
      expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('translates item-level negative <GOODS><ERROR> codes into Georgian + English even when RESULT.STATUS is 0', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        return xmlResponse(
          saveWaybillResultXml({
            status: 0,
            id: 0,
            goods: [
              { id: 0, error: 0, name: 'სწორი პოზიცია' },
              { id: 0, error: -2004, name: 'პრობლემური პოზიცია' },
            ],
          }),
        );
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        lineItems: [
          { name: 'სწორი პოზიცია', unitId: 1, quantity: 1, unitPrice: 10 },
          {
            name: 'პრობლემური პოზიცია',
            unitId: 99,
            unitText: 'ყუთი',
            quantity: 2,
            unitPrice: 5,
          },
        ],
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(
        result.content[0]?.type === 'text' ? result.content[0].text : '{}',
      ) as {
        error: string;
        code: number;
        georgianText: string;
        englishText: string;
        lineItemErrors: Array<{
          lineIndex: number;
          name?: string;
          code: number;
          georgianText: string;
          englishText: string;
        }>;
      };

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-2004);
      expect(payload.georgianText).toBe('მიუთითეთ ზომის ერთეულის დასახელება');
      expect(payload.englishText).toMatch(/UNIT_TXT/i);
      expect(payload.lineItemErrors).toHaveLength(1);
      expect(payload.lineItemErrors[0]).toMatchObject({
        lineIndex: 1,
        name: 'პრობლემური პოზიცია',
        code: -2004,
        georgianText: 'მიუთითეთ ზომის ერთეულის დასახელება',
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('includes translated lineItemErrors when RS.ge returns both negative top-level STATUS and item-level GOODS ERROR', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        return xmlResponse(
          saveWaybillResultXml({
            status: -1,
            id: 0,
            goods: [{ id: 0, error: -2002, name: 'უცნობი ერთეული' }],
          }),
        );
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
      const result = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        lineItems: [{ name: 'უცნობი ერთეული', unitId: 777, quantity: 1, unitPrice: 5 }],
      });

      expect(result.isError).toBe(true);
      const payload = JSON.parse(
        result.content[0]?.type === 'text' ? result.content[0].text : '{}',
      ) as {
        error: string;
        code: number;
        lineItemErrors: Array<{ code: number; englishText: string }>;
      };

      expect(payload.error).toBe('RSGE_API_ERROR');
      expect(payload.code).toBe(-1);
      expect(payload.lineItemErrors).toHaveLength(1);
      expect(payload.lineItemErrors[0]?.code).toBe(-2002);
      expect(payload.lineItemErrors[0]?.englishText).toMatch(/unit/i);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns translated auth error with IP-allowlist hint when chek_service_user fails and retries on subsequent call', async () => {
    let authAttempts = 0;
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        authAttempts += 1;
        if (authAttempts === 1) {
          return xmlResponse(checkServiceUserInvalidXml());
        }
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        return xmlResponse(saveWaybillResultXml({ status: 0, id: 4001 }));
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
      const failed = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: 10 }],
      });

      expect(failed.isError).toBe(true);
      const failedPayload = JSON.parse(
        failed.content[0]?.type === 'text' ? failed.content[0].text : '{}',
      ) as Record<string, unknown>;
      expect(failedPayload.error).toBe('RSGE_API_ERROR');
      expect(failedPayload.code).toBe(-3);
      expect(String(failedPayload.hint)).toMatch(/IP/i);

      // Next call retries seller identity resolution and succeeds
      const recovered = await client.callToolRaw('save_waybill_draft', {
        waybillType: 2,
        buyerTin: '206322102',
        startAddress: 'თბილისი',
        endAddress: 'ბათუმი',
        lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: 10 }],
      });
      expect(recovered.isError).toBeFalsy();
      expect(authAttempts).toBe(2);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('returns structured Georgian + English error when save_waybill returns STATUS=0 with missing or zero ID on creation', async () => {
    let saveAttempt = 0;
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      if (soapAction === '"http://tempuri.org/chek_service_user"') {
        return xmlResponse(checkServiceUserSuccessXml(731937, 20350));
      }
      if (soapAction === '"http://tempuri.org/save_waybill"') {
        saveAttempt += 1;
        if (saveAttempt === 1) {
          // STATUS=0 with <ID>0</ID>
          return xmlResponse(saveWaybillResultXml({ status: 0, id: 0 }));
        }
        // STATUS=0 with missing <ID> tag altogether
        return xmlResponse(saveWaybillResultXml({ status: 0 }));
      }
      throw new Error(`Unexpected SOAPAction: ${soapAction}`);
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    const draftInput = {
      waybillType: 3,
      buyerTin: '206322102',
      lineItems: [{ name: 'ტესტი', unitId: 1, quantity: 1, unitPrice: 10 }],
    };

    try {
      for (let i = 0; i < 2; i += 1) {
        const result = await client.callToolRaw('save_waybill_draft', draftInput);
        expect(result.isError).toBe(true);
        const payload = JSON.parse(
          result.content[0]?.type === 'text' ? result.content[0].text : '{}',
        ) as Record<string, unknown>;
        expect(payload.error).toBe('RSGE_MUTATION_FAILED');
        expect(payload.executed).toBe(false);
        expect(payload.waybillId).toBe(0);
        expect(String(payload.message)).toMatch(/[ა-ჰ]/);
        expect(String(payload.message)).toMatch(/[A-Za-z]{4,}/);
        expect(String(payload.hint)).toMatch(/[ა-ჰ]/);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
