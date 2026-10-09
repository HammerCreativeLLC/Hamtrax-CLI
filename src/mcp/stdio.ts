import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getApiKey } from '../auth/store.js';
import { resolveApiBase } from '../util/apiBase.js';
import { HttpClient, type RequestOptions } from '../util/http.js';
import { CLI_VERSION } from '../version.js';
import { createHamtraxMcpServer, type HamtraxMcpScope } from './server.js';

export interface HamtraxMcpStdioOptions {
  apiBase?: string;
  allowWrites?: boolean;
  allowDeletes?: boolean;
}

export async function startHamtraxMcpStdio(options: HamtraxMcpStdioOptions = {}) {
  const scopes: HamtraxMcpScope[] = ['read'];
  if (options.allowWrites) scopes.push('write');
  if (options.allowDeletes) scopes.push('delete');
  const server = createHamtraxMcpServer({
    version: CLI_VERSION, scopes, authentication: 'apiKey',
    client: {
      async request<T>(request: RequestOptions): Promise<T> {
        const client = new HttpClient({
          apiBase: resolveApiBase(options.apiBase), apiKey: await getApiKey(),
          userAgent: `hamtrax-mcp/${CLI_VERSION} node/${process.version}`,
        });
        return client.request<T>(request);
      },
    },
  });
  await server.connect(new StdioServerTransport());
  const close = () => { void server.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdin.once('end', close);
  return server;
}
