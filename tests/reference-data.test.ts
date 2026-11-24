import { describe, expect, it, vi } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import { DEFAULT_RSGE_ENDPOINT, createRsgeServer } from '../src/index.js';
import { createTestConfig } from './fixtures/mcp.js';
import {
  errorCodesXml,
  transportTypesXml,
  waybillTypesXml,
  waybillUnitsXml,
  xmlResponse,
} from './fixtures/soap.js';

describe('Reference Data MCP Resources', () => {
  it('registers all four Reference Data resources with Georgian-primary / English-secondary descriptions', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const resources = await client.listResources();
      const uris = resources.map((r) => r.uri);

      expect(uris).toEqual(
        expect.arrayContaining([
          'rsge://reference/waybill-types',
          'rsge://reference/units',
          'rsge://reference/transport-types',
          'rsge://reference/error-codes',
        ]),
      );

      for (const uri of [
        'rsge://reference/waybill-types',
        'rsge://reference/units',
        'rsge://reference/transport-types',
        'rsge://reference/error-codes',
      ]) {
        const resource = resources.find((r) => r.uri === uri);
        expect(resource).toBeDefined();
        expect(resource?.mimeType).toBe('application/json');
        expect(resource?.description).toMatch(/^[ა-ჰ]/);
        expect(resource?.description).toMatch(/[A-Za-z]{4,}/);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('reads rsge://reference/waybill-types via SOAP 1.1 get_waybill_types', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit | undefined }> =
      [];
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
      capturedRequests.push({ url: String(input), init });
      return xmlResponse(waybillTypesXml());
    });

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const contents = await client.readResource('rsge://reference/waybill-types');
      expect(contents).toHaveLength(1);
      expect(contents[0]?.uri).toBe('rsge://reference/waybill-types');
      expect(contents[0]?.mimeType).toBe('application/json');

      expect(capturedRequests).toHaveLength(1);
      const req = capturedRequests[0]!;
      expect(req.url).toBe(DEFAULT_RSGE_ENDPOINT);
      const headers = new Headers(req.init?.headers);
      expect(headers.get('soapaction')).toBe(
        '"http://tempuri.org/get_waybill_types"',
      );
      expect(String(req.init?.body)).toContain(
        '<get_waybill_types xmlns="http://tempuri.org/">',
      );

      const text = 'text' in contents[0]! ? contents[0]!.text : '';
      const payload = JSON.parse(text) as {
        category: string;
        resourceUri: string;
        count: number;
        items: Array<{ id: number; name: string; englishName?: string }>;
      };

      expect(payload.category).toBe('waybill_types');
      expect(payload.resourceUri).toBe('rsge://reference/waybill-types');
      expect(payload.count).toBe(3);
      expect(payload.items).toEqual([
        { id: 1, name: 'შიდა გადაზიდვა', englishName: 'Internal Transfer' },
        {
          id: 2,
          name: 'ტრანსპორტირებით',
          englishName: 'Delivery with Transportation',
        },
        {
          id: 3,
          name: 'ტრანსპორტირების გარეშე',
          englishName: 'Delivery without Transportation',
        },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('reads units, transport-types, and error-codes resources (including single-item and legacy WAYBILL_TYPES error-code XML)', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction');
      if (soapAction === '"http://tempuri.org/get_waybill_units"') {
        return xmlResponse(waybillUnitsXml([{ id: 1, name: 'ცალი' }]));
      }
      if (soapAction === '"http://tempuri.org/get_trans_types"') {
        return xmlResponse(transportTypesXml());
      }
      if (soapAction === '"http://tempuri.org/get_error_codes"') {
        return xmlResponse(errorCodesXml(undefined, 'WAYBILL_TYPES'));
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
      const unitsContent = await client.readResource('rsge://reference/units');
      const unitsPayload = JSON.parse(
        'text' in unitsContent[0]! ? unitsContent[0]!.text : '{}',
      ) as { category: string; count: number; items: unknown[] };
      expect(unitsPayload).toEqual({
        category: 'units',
        resourceUri: 'rsge://reference/units',
        count: 1,
        items: [{ id: 1, name: 'ცალი' }],
      });

      const transportContent = await client.readResource(
        'rsge://reference/transport-types',
      );
      const transportPayload = JSON.parse(
        'text' in transportContent[0]! ? transportContent[0]!.text : '{}',
      ) as { category: string; count: number; items: unknown[] };
      expect(transportPayload).toEqual({
        category: 'transport_types',
        resourceUri: 'rsge://reference/transport-types',
        count: 3,
        items: [
          { id: 1, name: 'საავტომობილო', englishName: 'Road / Automobile' },
          { id: 2, name: 'სარკინიგზო', englishName: 'Railway' },
          { id: 4, name: 'სხვა', englishName: 'Other' },
        ],
      });

      const errorsContent = await client.readResource(
        'rsge://reference/error-codes',
      );
      const errorsPayload = JSON.parse(
        'text' in errorsContent[0]! ? errorsContent[0]!.text : '{}',
      ) as {
        category: string;
        resourceUri: string;
        count: number;
        items: Array<{ code: number; text: string; type: number }>;
      };
      expect(errorsPayload.category).toBe('error_codes');
      expect(errorsPayload.resourceUri).toBe('rsge://reference/error-codes');
      expect(errorsPayload.count).toBe(4);
      expect(errorsPayload.items[0]).toMatchObject({
        code: -100,
        text: 'სერვისის მომხმარებლის სახელი ან პაროლი არასწორია',
        type: 1,
      });
      expect(errorsPayload.items[2]).toMatchObject({
        code: -1001,
        text: 'ზედნადების ტიპი არასწორია',
        type: 1,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('handles empty Reference Data XML containers gracefully', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn(async () =>
      xmlResponse(waybillTypesXml([])),
    );

    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const contents = await client.readResource(
        'rsge://reference/waybill-types',
      );
      const payload = JSON.parse(
        'text' in contents[0]! ? contents[0]!.text : '{}',
      ) as { count: number; items: unknown[] };
      expect(payload.count).toBe(0);
      expect(payload.items).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe('get_reference_data fallback tool & session cache reuse', () => {
  it('registers get_reference_data with readOnlyHint: true and Georgian-primary / English-secondary description', async () => {
    const server = createRsgeServer({
      config: createTestConfig(),
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      const tools = await client.listTools();
      const tool = tools.find((item) => item.name === 'get_reference_data');

      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.annotations?.destructiveHint).toBe(false);
      expect(tool?.description).toMatch(/^[ა-ჰ]/);
      expect(tool?.description).toMatch(/[A-Za-z]{4,}/);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('serves all four Reference Data categories via get_reference_data and shares a single session cache with MCP Resources', async () => {
    const callsByAction = new Map<string, number>();
    const fakeFetch: typeof globalThis.fetch = vi.fn(async (_input, init) => {
      const soapAction = new Headers(init?.headers).get('soapaction') ?? '';
      callsByAction.set(soapAction, (callsByAction.get(soapAction) ?? 0) + 1);

      if (soapAction === '"http://tempuri.org/get_waybill_types"') {
        return xmlResponse(waybillTypesXml());
      }
      if (soapAction === '"http://tempuri.org/get_waybill_units"') {
        return xmlResponse(waybillUnitsXml());
      }
      if (soapAction === '"http://tempuri.org/get_trans_types"') {
        return xmlResponse(transportTypesXml());
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
      // 1. Read via tool first, then via Resource, then via tool again -> only 1 fetch
      const toolWaybillTypes = await client.callToolRaw('get_reference_data', {
        category: 'waybill_types',
      });
      expect(toolWaybillTypes.isError).toBeFalsy();
      const toolPayload = JSON.parse(
        toolWaybillTypes.content[0]?.type === 'text'
          ? toolWaybillTypes.content[0].text
          : '{}',
      ) as Record<string, unknown>;

      const resourceWaybillTypes = await client.readResource(
        'rsge://reference/waybill-types',
      );
      const resourcePayload = JSON.parse(
        'text' in resourceWaybillTypes[0]! ? resourceWaybillTypes[0]!.text : '{}',
      ) as Record<string, unknown>;

      expect(toolPayload).toEqual(resourcePayload);

      await client.callToolRaw('get_reference_data', {
        category: 'waybill_types',
      });

      // 2. Concurrent reads of units across Resource + tool -> only 1 fetch
      const [unitsRes1, unitsRes2, unitsTool] = await Promise.all([
        client.readResource('rsge://reference/units'),
        client.readResource('rsge://reference/units'),
        client.callToolRaw('get_reference_data', { category: 'units' }),
      ]);
      expect(unitsRes1).toHaveLength(1);
      expect(unitsRes2).toHaveLength(1);
      expect(unitsTool.isError).toBeFalsy();

      // 3. Read transport_types and error_codes twice each -> 1 fetch per category
      await client.callToolRaw('get_reference_data', {
        category: 'transport_types',
      });
      await client.readResource('rsge://reference/transport-types');

      await client.readResource('rsge://reference/error-codes');
      const errorCodesTool = await client.callToolRaw('get_reference_data', {
        category: 'error_codes',
      });
      expect(errorCodesTool.isError).toBeFalsy();

      expect(callsByAction.get('"http://tempuri.org/get_waybill_types"')).toBe(
        1,
      );
      expect(callsByAction.get('"http://tempuri.org/get_waybill_units"')).toBe(
        1,
      );
      expect(callsByAction.get('"http://tempuri.org/get_trans_types"')).toBe(1);
      expect(callsByAction.get('"http://tempuri.org/get_error_codes"')).toBe(1);
      expect(fakeFetch).toHaveBeenCalledTimes(4);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects unknown Reference Data categories via Zod validation without calling RS.ge', async () => {
    const fakeFetch: typeof globalThis.fetch = vi.fn();
    const server = createRsgeServer({
      config: createTestConfig(),
      fetch: fakeFetch,
      logLevel: 'silent',
    });
    const client = await Client.connect(server);

    try {
      await expect(
        client.callToolRaw('get_reference_data', {
          category: 'wood_types',
        }),
      ).rejects.toThrow(/Invalid arguments|waybill_types/i);
      expect(fakeFetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
