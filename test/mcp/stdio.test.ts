import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

describe('packaged Hamtrax MCP entry points', () => {
  it.each([
    ['hamtrax-mcp', ['dist/mcp/cli.js']],
    ['hamtrax mcp', ['dist/cli.js', 'mcp']],
  ])('%s negotiates clean JSON-RPC stdout without credentials', async (_name, args) => {
    const configDir = await mkdtemp(join(tmpdir(), 'hamtrax-mcp-test-'));
    const client = new Client({ name: 'stdio-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(args[0]!), ...args.slice(1)],
      env: { PATH: process.env.PATH ?? '', HAMTRAX_NO_KEYRING: '1', XDG_CONFIG_HOME: configDir },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (data) => { stderr += String(data); });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe('0.2.0');
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['whoami', 'list_folders', 'list_contacts', 'list_activations']);
      expect(tools[0]?._meta?.securitySchemes).toEqual([{ type: 'noauth' }]);
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: 'unauthorized' });
      expect(stderr).toBe('');
    } finally {
      await client.close();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('requires explicit process flags to expose mutation tools', async () => {
    const client = new Client({ name: 'scope-test', version: '1' });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp/cli.js'), '--allow-writes', '--allow-deletes'], stderr: 'pipe' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(['whoami', 'list_folders', 'list_contacts', 'list_activations', 'create_contact', 'create_activation', 'delete_contact']);
    } finally {
      await client.close();
    }
  });

  it('provides the same factory and typed HTTP errors through CommonJS exports', async () => {
    const require = createRequire(import.meta.url);
    const { createHamtraxMcpServer } = require('hamtrax/mcp') as typeof import('../../src/mcp/server.js');
    const { HttpClient, ApiError } = require('hamtrax/http') as typeof import('../../src/util/http.js');
    const metadata = require('hamtrax/package.json') as { version: string };
    expect(typeof HttpClient).toBe('function');
    expect(metadata.version).toBe('0.2.0');
    const server = createHamtraxMcpServer({
      version: metadata.version,
      client: { async request<T>(): Promise<T> { throw new ApiError({ status: 403, code: 'tier_insufficient', message: 'Requires elevated tier.' }); } },
    });
    const client = new Client({ name: 'cjs-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      await client.listTools();
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ error: 'tier_insufficient', status: 403 });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
