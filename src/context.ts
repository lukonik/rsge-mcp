import type { RsgeConfig } from './config.js';
import type { RsgeLogger } from './logger.js';
import type { RsgeSoapClient } from './soap/index.js';

export interface ServerContext {
  readonly config: RsgeConfig;
  readonly logger: RsgeLogger;
  readonly soapClient: RsgeSoapClient;
}
