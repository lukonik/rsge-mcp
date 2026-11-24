import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@prefecthq/fastmcp-ts/client';
import type { FastMCP } from '@prefecthq/fastmcp-ts/server';
import {
  REFERENCE_RESOURCE_URIS,
  createRsgeServer,
  loadConfig,
  type ReferenceCategory,
  type RsgeConfig,
} from '../../src/index.js';

const LIVE_TESTS_ENABLED = process.env.RSGE_LIVE_TESTS === '1';
const DEFAULT_LIVE_TEST_TIN = '206322102';
const LIVE_TIMEOUT_MS = 30_000;

interface ToolCallRawResult {
  readonly isError?: boolean;
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

function parseToolJson<T>(result: ToolCallRawResult): T {
  const first = result.content[0];
  expect(first?.type).toBe('text');
  const text = first?.type === 'text' && typeof first.text === 'string' ? first.text : '';
  return JSON.parse(text) as T;
}

function parseResourceJson<T>(
  contents: ReadonlyArray<{ readonly uri: string; readonly mimeType?: string; readonly text?: string }>,
): T {
  const first = contents[0];
  expect(first).toBeDefined();
  const text = first && 'text' in first && typeof first.text === 'string' ? first.text : '';
  return JSON.parse(text) as T;
}

function formatDateYmd(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatLocalIsoDateTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${formatDateYmd(date)}T${hh}:${min}:${ss}`;
}

describe.skipIf(!LIVE_TESTS_ENABLED)(
  'RS.ge live integration suite (services.rs.ge)',
  () => {
    let config: RsgeConfig;
    let server: FastMCP | undefined;
    let client: Client | undefined;

    const testTin =
      process.env.RSGE_LIVE_TEST_TIN?.trim() || DEFAULT_LIVE_TEST_TIN;

    beforeAll(async () => {
      config = loadConfig(process.env);
      server = createRsgeServer({
        config,
        fetch: globalThis.fetch,
        logLevel: 'silent',
      });
      client = await Client.connect(server);
    }, LIVE_TIMEOUT_MS);

    afterAll(async () => {
      if (client) {
        await client.close();
      }
      if (server) {
        await server.close();
      }
    }, LIVE_TIMEOUT_MS);

    it(
      'verifies live Service User credentials and IP allowlisting via check_connection',
      async () => {
        const result = await client!.callToolRaw('check_connection', {});
        expect(result.isError).toBeFalsy();

        const payload = parseToolJson<{
          connected: boolean;
          unId: number;
          serviceUserId: number;
          endpoint: string;
          message: string;
        }>(result);

        expect(payload.connected).toBe(true);
        expect(payload.unId).toBeGreaterThan(0);
        expect(payload.serviceUserId).toBeGreaterThan(0);
        expect(payload.endpoint).toBe(config.endpoint);
        expect(payload.message).toMatch(/[ა-ჰ]/);

        const serialized = JSON.stringify(payload);
        expect(serialized).not.toContain(config.serviceUser);
        expect(serialized).not.toContain(config.servicePassword);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'fetches live Reference Data via all four MCP Resources and get_reference_data tool',
      async () => {
        const categories: readonly ReferenceCategory[] = [
          'waybill_types',
          'units',
          'transport_types',
          'error_codes',
        ];

        for (const category of categories) {
          const uri = REFERENCE_RESOURCE_URIS[category];
          const resourceContents = await client!.readResource(uri);
          expect(resourceContents).toHaveLength(1);
          expect(resourceContents[0]?.uri).toBe(uri);
          expect(resourceContents[0]?.mimeType).toBe('application/json');

          const resourcePayload = parseResourceJson<{
            category: string;
            resourceUri: string;
            count: number;
            items: ReadonlyArray<Record<string, unknown>>;
          }>(resourceContents);

          expect(resourcePayload.category).toBe(category);
          expect(resourcePayload.resourceUri).toBe(uri);
          expect(resourcePayload.count).toBeGreaterThan(0);
          expect(resourcePayload.items).toHaveLength(resourcePayload.count);

          const toolResult = await client!.callToolRaw('get_reference_data', {
            category,
          });
          expect(toolResult.isError).toBeFalsy();
          const toolPayload = parseToolJson<typeof resourcePayload>(toolResult);
          expect(toolPayload).toEqual(resourcePayload);
        }
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'looks up a live Taxpayer name and VAT status via lookup_taxpayer',
      async () => {
        const result = await client!.callToolRaw('lookup_taxpayer', {
          tin: testTin,
        });
        expect(result.isError).toBeFalsy();

        const payload = parseToolJson<{
          found: boolean;
          tin: string;
          taxpayerType: 'legal_entity' | 'individual';
          name: string | null;
          isVatPayer: boolean;
        }>(result);

        expect(payload.tin).toBe(testTin);
        expect(payload.taxpayerType).toBe(
          testTin.length === 9 ? 'legal_entity' : 'individual',
        );
        expect(payload.found).toBe(true);
        expect(typeof payload.name).toBe('string');
        expect(payload.name!.length).toBeGreaterThan(0);
        expect(typeof payload.isVatPayer).toBe('boolean');
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'queries outgoing and incoming Waybills via list_waybills',
      async () => {
        const today = new Date();
        const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        const dateFilter = {
          create_date_from: formatDateYmd(thirtyDaysAgo),
          create_date_to: formatDateYmd(today),
        };

        const outgoingResult = await client!.callToolRaw('list_waybills', {
          direction: 'outgoing',
          ...dateFilter,
        });
        expect(outgoingResult.isError).toBeFalsy();
        const outgoingPayload = parseToolJson<{
          direction: string;
          operation: string;
          count: number;
          items: ReadonlyArray<Record<string, unknown>>;
        }>(outgoingResult);
        expect(outgoingPayload.direction).toBe('outgoing');
        expect(outgoingPayload.operation).toBe('get_waybills');
        expect(outgoingPayload.count).toBeGreaterThanOrEqual(0);
        expect(outgoingPayload.items).toHaveLength(outgoingPayload.count);

        const incomingResult = await client!.callToolRaw('list_waybills', {
          direction: 'incoming',
          ...dateFilter,
        });
        expect(incomingResult.isError).toBeFalsy();
        const incomingPayload = parseToolJson<{
          direction: string;
          operation: string;
          count: number;
          items: ReadonlyArray<Record<string, unknown>>;
        }>(incomingResult);
        expect(incomingPayload.direction).toBe('incoming');
        expect(incomingPayload.operation).toBe('get_buyer_waybills');
        expect(incomingPayload.count).toBeGreaterThanOrEqual(0);
        expect(incomingPayload.items).toHaveLength(incomingPayload.count);
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'executes safe Draft Waybill lifecycle (save_waybill_draft -> get_waybill -> two-step delete_waybill_draft) with cleanup',
      async () => {
        let createdWaybillId: number | undefined;
        let deleted = false;

        try {
          // 1. Create an unactivated Draft Waybill (Type 3: Delivery without Transportation)
          const saveResult = await client!.callToolRaw('save_waybill_draft', {
            waybillType: 3,
            buyerTin: testTin,
            buyerIsGeorgian: true,
            beginDate: formatLocalIsoDateTime(new Date()),
            comment: 'rsge-mcp live integration test draft (safe to delete)',
            lineItems: [
              {
                name: 'სატესტო პროდუქტი (rsge-mcp live test)',
                unitId: 1,
                quantity: 2,
                unitPrice: 1.5,
                vatType: 0,
              },
            ],
          });
          expect(saveResult.isError).toBeFalsy();

          const saved = parseToolJson<{
            waybillId: number;
            status: number;
            statusEnglishName: string;
            fullAmount: number;
            fullAmountFormatted: string;
            lineItems: ReadonlyArray<{
              id: number;
              name: string;
              amount: number;
            }>;
          }>(saveResult);

          expect(saved.waybillId).toBeGreaterThan(0);
          createdWaybillId = saved.waybillId;
          expect(saved.status).toBe(0);
          expect(saved.statusEnglishName).toBe('Draft');
          expect(saved.fullAmount).toBe(3);
          expect(saved.fullAmountFormatted).toBe('3.00');
          expect(saved.lineItems).toHaveLength(1);

          // 2. Retrieve the saved Draft Waybill via get_waybill
          const getResult = await client!.callToolRaw('get_waybill', {
            waybill_id: createdWaybillId,
          });
          expect(getResult.isError).toBeFalsy();

          const fetched = parseToolJson<{
            found: boolean;
            waybill: {
              id: number;
              status: number;
              statusEnglish: string;
              fullAmount: number;
              lineItems: ReadonlyArray<{ name: string; amount: number }>;
            };
          }>(getResult);

          expect(fetched.found).toBe(true);
          expect(fetched.waybill.id).toBe(createdWaybillId);
          expect(fetched.waybill.status).toBe(0);
          expect(fetched.waybill.statusEnglish).toBe('Draft');
          expect(fetched.waybill.fullAmount).toBe(3);
          expect(fetched.waybill.lineItems).toHaveLength(1);

          // 3. Delete the Draft Waybill via ADR-0002 two-step confirmation
          const previewResult = await client!.callToolRaw(
            'delete_waybill_draft',
            { waybill_id: createdWaybillId },
          );
          expect(previewResult.isError).toBeFalsy();

          const preview = parseToolJson<{
            requiresConfirmation: boolean;
            executed: boolean;
            action: string;
            confirmation_token: string;
            waybill: { id: number; status: number };
            summary: string;
          }>(previewResult);

          expect(preview.requiresConfirmation).toBe(true);
          expect(preview.executed).toBe(false);
          expect(preview.action).toBe('delete_waybill_draft');
          expect(preview.waybill.id).toBe(createdWaybillId);
          expect(preview.confirmation_token.length).toBeGreaterThan(0);
          expect(preview.summary).toMatch(/[ა-ჰ]/);

          const deleteResult = await client!.callToolRaw(
            'delete_waybill_draft',
            {
              waybill_id: createdWaybillId,
              confirmation_token: preview.confirmation_token,
            },
          );
          expect(deleteResult.isError).toBeFalsy();

          const deletedPayload = parseToolJson<{
            executed: boolean;
            action: string;
            waybillId: number;
            status: number;
            statusEnglish: string;
          }>(deleteResult);

          expect(deletedPayload.executed).toBe(true);
          expect(deletedPayload.action).toBe('delete_waybill_draft');
          expect(deletedPayload.waybillId).toBe(createdWaybillId);
          expect(deletedPayload.status).toBe(-1);
          expect(deletedPayload.statusEnglish).toBe('Deleted');
          deleted = true;
        } finally {
          // Best-effort cleanup so failed assertions never leave orphan Draft Waybills
          if (createdWaybillId !== undefined && !deleted && client) {
            try {
              const cleanupPreview = await client.callToolRaw(
                'delete_waybill_draft',
                { waybill_id: createdWaybillId },
              );
              if (!cleanupPreview.isError) {
                const parsed = parseToolJson<{ confirmation_token?: string }>(
                  cleanupPreview,
                );
                if (parsed.confirmation_token) {
                  await client.callToolRaw('delete_waybill_draft', {
                    waybill_id: createdWaybillId,
                    confirmation_token: parsed.confirmation_token,
                  });
                }
              }
            } catch {
              // Ignore secondary cleanup errors so original assertion failure surfaces clearly
            }
          }
        }
      },
      LIVE_TIMEOUT_MS,
    );
  },
);
