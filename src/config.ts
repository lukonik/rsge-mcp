export const DEFAULT_RSGE_ENDPOINT =
  'https://services.rs.ge/WayBillService/WayBillService.asmx';

export interface RsgeConfig {
  readonly serviceUser: string;
  readonly servicePassword: string;
  readonly endpoint: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RsgeConfig {
  const serviceUser = env.RSGE_SERVICE_USER?.trim() ?? '';
  const servicePassword = env.RSGE_SERVICE_PASSWORD?.trim() ?? '';
  const rawEndpoint = env.RSGE_ENDPOINT?.trim();

  const missing: string[] = [];
  if (!serviceUser) {
    missing.push('RSGE_SERVICE_USER');
  }
  if (!servicePassword) {
    missing.push('RSGE_SERVICE_PASSWORD');
  }

  if (missing.length > 0) {
    const vars = missing.join(', ');
    throw new ConfigError(
      `RS.ge სერვისის მომხმარებლის აუცილებელი გარემოს ცვლადები არ არის მითითებული: ${vars}. ` +
        `Missing required RS.ge Service User environment variable(s): ${vars}. ` +
        `გთხოვთ მიუთითოთ RSGE_SERVICE_USER და RSGE_SERVICE_PASSWORD MCP კლიენტის კონფიგურაციაში. ` +
        `Please set RSGE_SERVICE_USER and RSGE_SERVICE_PASSWORD in your MCP client configuration.`,
    );
  }

  const endpoint = rawEndpoint && rawEndpoint.length > 0 ? rawEndpoint : DEFAULT_RSGE_ENDPOINT;

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new ConfigError(
      `RSGE_ENDPOINT მნიშვნელობა არასწორი URL-ია. Invalid RSGE_ENDPOINT URL; expected an http(s) URL.`,
    );
  }

  return {
    serviceUser,
    servicePassword,
    endpoint,
  };
}
