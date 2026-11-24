import { spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client, StdioTransport } from '@prefecthq/fastmcp-ts/client';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

describe('rsge-mcp CLI stdio smoke test', () => {
  it('produces an executable dist/cli.js binary with a node shebang', () => {
    accessSync(CLI_PATH, constants.X_OK);
    const firstLine = readFileSync(CLI_PATH, 'utf8').split('\n')[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('speaks pure JSON-RPC on stdout, lists check_connection, and leaks zero credentials', async () => {
    const secretUser = 'cli_smoke_user:206322102';
    const secretPass = 'cli-smoke-secret-password';

    const child = spawn(process.execPath, [CLI_PATH], {
      env: {
        ...process.env,
        RSGE_SERVICE_USER: secretUser,
        RSGE_SERVICE_PASSWORD: secretPass,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutLines: string[] = [];
    let stdoutBuffer = '';
    let stderrOutput = '';

    const waitForMessageId = (targetId: number): Promise<JsonRpcResponse> =>
      new Promise((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
          rejectPromise(
            new Error(
              `Timed out waiting for JSON-RPC response id=${targetId}. stderr=${stderrOutput}`,
            ),
          );
        }, 5000);

        const checkExisting = (): boolean => {
          for (const line of stdoutLines) {
            const parsed = JSON.parse(line) as JsonRpcResponse;
            if (parsed.id === targetId) {
              clearTimeout(timeout);
              resolvePromise(parsed);
              return true;
            }
          }
          return false;
        };

        if (checkExisting()) return;

        const onLine = () => {
          if (checkExisting()) {
            child.stdout.off('data', onLine);
          }
        };
        child.stdout.on('data', onLine);
      });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8');
      const parts = stdoutBuffer.split('\n');
      stdoutBuffer = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          stdoutLines.push(trimmed);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString('utf8');
    });

    try {
      const send = (payload: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify(payload)}\n`);
      };

      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
        },
      });
      const initRes = await waitForMessageId(1);
      expect(initRes.jsonrpc).toBe('2.0');
      expect(initRes.error).toBeUndefined();

      send({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });

      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });
      const listRes = await waitForMessageId(2);
      expect(listRes.jsonrpc).toBe('2.0');
      expect(listRes.error).toBeUndefined();

      const tools = (listRes.result?.tools ?? []) as Array<{
        name: string;
        annotations?: { readOnlyHint?: boolean };
      }>;
      const checkConnection = tools.find((t) => t.name === 'check_connection');
      expect(checkConnection).toBeDefined();
      expect(checkConnection?.annotations?.readOnlyHint).toBe(true);

      // Every single stdout line must be a valid JSON-RPC 2.0 frame
      expect(stdoutLines.length).toBeGreaterThanOrEqual(2);
      for (const line of stdoutLines) {
        const frame = JSON.parse(line) as JsonRpcResponse;
        expect(frame.jsonrpc).toBe('2.0');
      }

      // Zero credential leakage on stdout or stderr
      const allStdout = stdoutLines.join('\n');
      expect(allStdout).not.toContain(secretUser);
      expect(allStdout).not.toContain(secretPass);
      expect(stderrOutput).not.toContain(secretUser);
      expect(stderrOutput).not.toContain(secretPass);
    } finally {
      child.stdin.end();
      child.kill('SIGTERM');
    }
  });

  it('connects cleanly via FastMCP StdioTransport and lists check_connection', async () => {
    const client = await Client.connect(
      new StdioTransport(process.execPath, [CLI_PATH], {
        env: {
          ...process.env,
          RSGE_SERVICE_USER: 'transport_user:206322102',
          RSGE_SERVICE_PASSWORD: 'transport-password',
        },
      }),
    );

    try {
      const tools = await client.listTools();
      const checkConnection = tools.find((t) => t.name === 'check_connection');
      expect(checkConnection).toBeDefined();
      expect(checkConnection?.annotations?.readOnlyHint).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('exits non-zero with Georgian + English error on stderr and empty stdout when credentials are missing', async () => {
    const env = { ...process.env };
    delete env.RSGE_SERVICE_USER;
    delete env.RSGE_SERVICE_PASSWORD;

    const child = spawn(process.execPath, [CLI_PATH], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const exitCode = await new Promise<number | null>((resolvePromise) => {
      child.on('close', (code) => resolvePromise(code));
    });

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toMatch(/[ა-ჰ]/);
    expect(stderr).toContain('RSGE_SERVICE_USER');
    expect(stderr).toContain('RSGE_SERVICE_PASSWORD');
  });
});
