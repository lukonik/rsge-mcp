import type { FrameworkLogLevel, Logger } from '@prefecthq/fastmcp-ts/server';

export type LogLevel = FrameworkLogLevel;

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface CreateLoggerOptions {
  readonly secrets: readonly string[];
  readonly stream?: NodeJS.WritableStream;
  readonly level?: LogLevel;
}

export interface RsgeLogger extends Logger {
  redact(text: string): string;
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) {
      result = result.split(secret).join('[REDACTED]');
    }
  }
  return result;
}

function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value, secrets);
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSecrets(value.message, secrets),
      ...(value.stack ? { stack: redactSecrets(value.stack, secrets) } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, secrets));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactValue(entry, secrets);
    }
    return out;
  }
  return value;
}

export function createLogger(options: CreateLoggerOptions): RsgeLogger {
  const secrets = options.secrets.filter((s) => s.length > 0);
  const stream = options.stream ?? process.stderr;
  const minPriority = LEVEL_PRIORITY[options.level ?? 'info'];

  const write = (
    level: Exclude<LogLevel, 'silent'>,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (LEVEL_PRIORITY[level] < minPriority) {
      return;
    }

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: redactSecrets(message, secrets),
    };

    if (meta && Object.keys(meta).length > 0) {
      entry.meta = redactValue(meta, secrets);
    }

    stream.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug(message, meta) {
      write('debug', message, meta);
    },
    info(message, meta) {
      write('info', message, meta);
    },
    warn(message, meta) {
      write('warn', message, meta);
    },
    error(message, meta) {
      write('error', message, meta);
    },
    redact(text: string) {
      return redactSecrets(text, secrets);
    },
  };
}
