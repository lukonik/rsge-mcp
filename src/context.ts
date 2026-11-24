import type { RsgeConfig } from './config.js';
import type { ConfirmationTokenStore } from './confirmation/index.js';
import type { RsgeLogger } from './logger.js';
import type { ReferenceDataStore } from './reference/index.js';
import type { RsgeSoapClient } from './soap/index.js';

export interface ServerContext {
  readonly config: RsgeConfig;
  readonly logger: RsgeLogger;
  readonly soapClient: RsgeSoapClient;
  readonly referenceData: ReferenceDataStore;
  readonly confirmationStore: ConfirmationTokenStore;
}
