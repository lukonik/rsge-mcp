#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createLogger, type LogLevel } from './logger.js';
import { createRsgeServer } from './server.js';

const VALID_LOG_LEVELS = new Set<LogLevel>([
  'debug',
  'info',
  'warn',
  'error',
  'silent',
]);

function resolveLogLevel(raw: string | undefined): LogLevel {
  if (raw && VALID_LOG_LEVELS.has(raw as LogLevel)) {
    return raw as LogLevel;
  }
  return 'info';
}

async function main(): Promise<void> {
  const logLevel = resolveLogLevel(process.env.FASTMCP_LOG_LEVEL);

  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    const logger = createLogger({
      secrets: [
        process.env.RSGE_SERVICE_USER ?? '',
        process.env.RSGE_SERVICE_PASSWORD ?? '',
      ],
      level: 'error',
    });
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    process.exitCode = 1;
    return;
  }

  const server = createRsgeServer({ config, logLevel });

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });

  await server.run({ transport: 'stdio' });
}

main().catch((error) => {
  const logger = createLogger({
    secrets: [
      process.env.RSGE_SERVICE_USER ?? '',
      process.env.RSGE_SERVICE_PASSWORD ?? '',
    ],
    level: 'error',
  });
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`RS.ge MCP სერვერის შეცდომა / RS.ge MCP server error: ${message}`);
  process.exitCode = 1;
});
