import { loadConfig, type RsgeConfig } from '../../src/index.js';

export interface ToolCallResultLike {
  readonly isError?: boolean;
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
}

export interface ResourceContentLike {
  readonly uri: string;
  readonly mimeType?: string;
  readonly text?: string;
}

export function createTestConfig(
  serviceUser = 'demo_user:206322102',
  servicePassword = 'demo-secret-password',
): RsgeConfig {
  return loadConfig({
    RSGE_SERVICE_USER: serviceUser,
    RSGE_SERVICE_PASSWORD: servicePassword,
  });
}

export function parseToolJson<T = Record<string, unknown>>(
  result: ToolCallResultLike,
): T {
  const first = result.content[0];
  return JSON.parse(
    first && first.type === 'text' && typeof first.text === 'string'
      ? first.text
      : '{}',
  ) as T;
}

export function parseResourceJson<T = Record<string, unknown>>(
  contents: ReadonlyArray<ResourceContentLike>,
): T {
  const first = contents[0];
  return JSON.parse(
    first && typeof first.text === 'string' ? first.text : '{}',
  ) as T;
}
