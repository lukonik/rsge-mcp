import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CONFIRMATION_TOKEN_TTL_MS = 5 * 60 * 1000;

export const CONFIRMATION_TOKEN_ARG_KEY = 'confirmation_token';

const STALE_RETENTION_MULTIPLIER = 12;

export interface IssuedConfirmationToken {
  readonly token: string;
  readonly expiresAt: number;
  readonly ttlMs: number;
}

export type ConfirmationRejectionReason =
  | 'invalid'
  | 'already_used'
  | 'expired'
  | 'tool_mismatch'
  | 'args_mismatch';

export type ConsumeConfirmationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: ConfirmationRejectionReason;
      readonly expectedToolName?: string;
    };

export interface ConfirmationTokenStore {
  issue(toolName: string, args: Record<string, unknown>): IssuedConfirmationToken;
  consume(
    token: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ConsumeConfirmationResult;
}

export interface CreateConfirmationTokenStoreOptions {
  readonly ttlMs?: number;
}

interface StoredTokenRecord {
  readonly tokenDigest: Buffer;
  readonly toolName: string;
  readonly argsHash: Buffer;
  readonly createdAt: number;
  readonly expiresAt: number;
  used: boolean;
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const entry = record[key];
    if (entry !== undefined) {
      normalized[key] = canonicalizeValue(entry);
    }
  }
  return normalized;
}

export function canonicalizeConfirmationArgs(
  args: Record<string, unknown>,
): string {
  const withoutToken: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === CONFIRMATION_TOKEN_ARG_KEY || value === undefined) {
      continue;
    }
    withoutToken[key] = value;
  }
  return JSON.stringify(canonicalizeValue(withoutToken));
}

export function computeCanonicalArgsHash(
  args: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(canonicalizeConfirmationArgs(args), 'utf8')
    .digest('hex');
}

function safeBuffersEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function createConfirmationTokenStore(
  options: CreateConfirmationTokenStoreOptions = {},
): ConfirmationTokenStore {
  const ttlMs = options.ttlMs ?? CONFIRMATION_TOKEN_TTL_MS;
  const records = new Map<string, StoredTokenRecord>();

  function pruneStaleRecords(now: number): void {
    const retentionCutoff = now - ttlMs * STALE_RETENTION_MULTIPLIER;
    for (const [key, record] of records.entries()) {
      if (record.expiresAt <= retentionCutoff) {
        records.delete(key);
      }
    }
  }

  function issue(
    toolName: string,
    args: Record<string, unknown>,
  ): IssuedConfirmationToken {
    const now = Date.now();
    pruneStaleRecords(now);

    const token = randomBytes(32).toString('base64url');
    const tokenDigest = sha256Buffer(token);
    const tokenKey = tokenDigest.toString('hex');
    const argsHash = Buffer.from(computeCanonicalArgsHash(args), 'hex');
    const expiresAt = now + ttlMs;

    records.set(tokenKey, {
      tokenDigest,
      toolName,
      argsHash,
      createdAt: now,
      expiresAt,
      used: false,
    });

    return {
      token,
      expiresAt,
      ttlMs,
    };
  }

  function consume(
    token: string,
    toolName: string,
    args: Record<string, unknown>,
  ): ConsumeConfirmationResult {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'invalid' };
    }

    const presentedDigest = sha256Buffer(trimmed);
    const record = records.get(presentedDigest.toString('hex'));

    if (!record || !safeBuffersEqual(record.tokenDigest, presentedDigest)) {
      return { ok: false, reason: 'invalid' };
    }

    if (record.used) {
      return { ok: false, reason: 'already_used' };
    }

    if (Date.now() >= record.expiresAt) {
      return { ok: false, reason: 'expired' };
    }

    if (record.toolName !== toolName) {
      return {
        ok: false,
        reason: 'tool_mismatch',
        expectedToolName: record.toolName,
      };
    }

    const actualArgsHash = Buffer.from(computeCanonicalArgsHash(args), 'hex');
    if (!safeBuffersEqual(record.argsHash, actualArgsHash)) {
      return { ok: false, reason: 'args_mismatch' };
    }

    record.used = true;
    return { ok: true };
  }

  return {
    issue,
    consume,
  };
}
