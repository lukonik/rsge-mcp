import { FastMCP } from '@prefecthq/fastmcp-ts/server';
import type { RsgeConfig } from './config.js';
import type { ServerContext } from './context.js';
import { createLogger, type LogLevel } from './logger.js';
import { createSoapClient } from './soap/index.js';
import { registerCheckConnectionTool } from './tools/check-connection.js';

export const SERVER_NAME = 'rsge-mcp';
export const SERVER_VERSION = '0.1.0';

export interface CreateRsgeServerOptions {
  readonly config: RsgeConfig;
  readonly fetch?: typeof globalThis.fetch;
  readonly logStream?: NodeJS.WritableStream;
  readonly logLevel?: LogLevel;
}

export function createRsgeServer(options: CreateRsgeServerOptions): FastMCP {
  const logLevel = options.logLevel ?? 'info';
  const logger = createLogger({
    secrets: [options.config.serviceUser, options.config.servicePassword],
    stream: options.logStream,
    level: logLevel,
  });

  const soapClient = createSoapClient({
    config: options.config,
    logger,
    fetch: options.fetch,
  });

  const context: ServerContext = {
    config: options.config,
    logger,
    soapClient,
  };

  const server = new FastMCP({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    instructions:
      'RS.ge ელექტრონული ზედნადებების (WayBillService) MCP სერვერი. ' +
      'Local MCP server for Revenue Service of Georgia (RS.ge) WayBillService.',
    logger,
    logLevel,
  });

  registerCheckConnectionTool(server, context);

  return server;
}
