import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHamtraxMcpServer, type HamtraxMcpScope } from '../../src/mcp/server.js';
import { ApiError, NetworkError } from '../../src/util/errors.js';
import type { RequestOptions } from '../../src/util/http.js';

const connections: Array<{ client: Client; server: ReturnType<typeof createHamtraxMcpServer> }> = [];

async function connect(
  response: unknown = { items: [] },
  scopes?: HamtraxMcpScope[],
  handler?: (request: RequestOptions) => unknown,
) {
  const request = vi.fn(async (options: RequestOptions) => handler ? handler(options) : response);
  const server = createHamtraxMcpServer({
    version: '0.2.0-test', scopes,
    client: { request: async <T>(options: RequestOptions) => await request(options) as T },
  });
  const client = new Client({ name: 'hamtrax-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sent: unknown[] = [];
  const send = serverTransport.send.bind(serverTransport);
  serverTransport.send = async (message, options) => { sent.push(message); await send(message, options); };
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  connections.push({ client, server });
  return { client, request, sent };
}

afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});

describe('Hamtrax MCP protocol', () => {
  it('can initialize with no granted scopes without exposing any actions', async () => {
    const { client, request } = await connect({}, []);
    expect((await client.listTools()).tools).toEqual([]);
    await expect(client.callTool({ name: 'whoami', arguments: {} })).rejects.toMatchObject({ code: -32601 });
    expect(request).not.toHaveBeenCalled();
  });
  it('exposes only four bounded read tools by default with exact OAuth metadata', async () => {
    const { client, sent } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['whoami', 'list_folders', 'list_contacts', 'list_activations']);
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true });
      expect(tool._meta?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['read'] }]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema?.type).toBe('object');
    }
    const wire = sent.find((message) => (message as { result?: { tools?: unknown } }).result?.tools) as { result: { tools: Array<{ securitySchemes: unknown }> } };
    expect(wire.result.tools[0]?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['read'] }]);
  });

  it('publishes write/delete tools only under their separately granted scopes', async () => {
    const { client, sent } = await connect({}, ['read', 'write', 'delete']);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['whoami', 'list_folders', 'list_contacts', 'list_activations', 'create_contact', 'create_activation', 'delete_contact']);
    expect(tools.find((tool) => tool.name === 'create_contact')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: true });
    expect(tools.find((tool) => tool.name === 'create_activation')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(tools.find((tool) => tool.name === 'delete_contact')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    const wire = sent.find((message) => (message as { result?: { tools?: unknown } }).result?.tools) as { result: { tools: Array<{ name: string; securitySchemes: unknown }> } };
    expect(wire.result.tools.find((tool) => tool.name === 'delete_contact')?.securitySchemes).toEqual([{ type: 'oauth2', scopes: ['delete'] }]);
  });

  it('does not permit invoking a write omitted from the granted tools', async () => {
    const { client, request } = await connect();
    const result = await client.callTool({ name: 'delete_contact', arguments: { qso_id: 'q1', confirmation: 'DELETE q1', idempotency_key: 'delete-1' } });
    expect(result.isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('reads whoami through the existing request seam and strips private fields', async () => {
    const { client, request } = await connect({ callsign: 'K1ABC', plan: 'free', tier: 'basic', nativeQsoCount: 7, userId: 'private-uid', apiKey: 'secret' });
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: 'v1/whoami', signal: expect.any(AbortSignal) }));
    expect(result.structuredContent).toEqual({ callsign: 'K1ABC', plan: 'free', tier: 'basic', nativeQsoCount: 7 });
  });

  it('keeps pagination one page, forwards server filters, and removes precise locations', async () => {
    const { client, request } = await connect({ items: [{ id: 'f1', name: 'October', userId: 'private', latitude: 38.123456, longitude: -94.123456, equipment: { apiKey: 'secret' }, startTime: { _seconds: 1791504000, _nanoseconds: 0 } }], cursor: 'next-page' });
    const result = await client.callTool({ name: 'list_folders', arguments: { type: 'activation', limit: 5, cursor: 'prior-page' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: 'v1/folders', query: { type: 'activation', limit: 5, cursor: 'prior-page' } }));
    expect(result.structuredContent).toEqual({ items: [{ id: 'f1', name: 'October', startTime: new Date(1791504000000).toISOString() }], cursor: 'next-page' });
  });

  it('reads contacts by a single folder path and redacts credentials inside saved notes', async () => {
    const { client, request } = await connect({ items: [{ id: 'q1', callsign: 'K2XYZ', notes: 'Key htx_live_abcdefghijklmnopqrstuvwxyz and Bearer secret-token', myLatitude: 38.123456, myLocation: { longitude: -94.123456 }, userId: 'private' }] });
    const result = await client.callTool({ name: 'list_contacts', arguments: { folder_id: 'f1', limit: 10 } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: 'v1/folders/f1/contacts', query: { limit: 10 } }));
    expect(result.structuredContent).toEqual({ items: [{ id: 'q1', callsign: 'K2XYZ', notes: 'Key [redacted] and Bearer [redacted]' }] });
  });

  it('rejects a path traversal, oversized page, and unexpected fields before any request', async () => {
    const { client, request } = await connect();
    for (const arguments_ of [{ folder_id: '../other' }, { folder_id: 'f1', limit: 201 }, { folder_id: 'f1', api_key: 'hidden-value' }]) {
      expect((await client.callTool({ name: 'list_contacts', arguments: arguments_ })).isError).toBe(true);
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('forwards activation state filters using the released HTTP shape', async () => {
    const { client, request } = await connect();
    await client.callTool({ name: 'list_activations', arguments: { in_progress: true, limit: 20, cursor: 'next' } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: 'v1/activations', query: { inProgress: true, limit: 20, cursor: 'next' } }));
  });

  it('requires a stable idempotency identity and timestamp for contact creation', async () => {
    const { client, request } = await connect({ id: 'q1', replayed: false }, ['write']);
    const arguments_ = { folder_id: 'f1', callsign: 'K2XYZ', frequency: 14.074, mode: 'FT8', time_on: '2026-10-09T14:00:00Z' };
    expect((await client.callTool({ name: 'create_contact', arguments: arguments_ })).isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
    const result = await client.callTool({ name: 'create_contact', arguments: { ...arguments_, idempotency_key: 'contact-1', sig: 'POTA', sig_info: 'US-1234', my_sig: 'POTA', my_sig_info: 'US-5678', rst_sent: '59' } });
    expect(result.structuredContent).toEqual({ id: 'q1', replayed: false });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: 'v1/contacts', idempotencyKey: 'contact-1', body: expect.objectContaining({ folderId: 'f1', callsign: 'K2XYZ', frequency: 14.074, mode: 'FT8', timeOn: '2026-10-09T14:00:00Z', sig: 'POTA', sigInfo: 'US-1234', mySig: 'POTA', mySigInfo: 'US-5678', rstSent: '59' }) }));
  });

  it('requires stable activation day and preserves canonical find/create behavior', async () => {
    const { client, request } = await connect({ id: 'a1', name: 'Park', autoFolderKey: 'pota:key', created: false }, ['write']);
    const arguments_ = { callsign: 'K1ABC', location_reference: 'K-1234', idempotency_key: 'activation-1' };
    expect((await client.callTool({ name: 'create_activation', arguments: arguments_ })).isError).toBe(true);
    const result = await client.callTool({ name: 'create_activation', arguments: { ...arguments_, start_time: '2026-10-09T14:00:00Z' } });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: 'v1/activations', idempotencyKey: 'activation-1', body: expect.objectContaining({ callsign: 'K1ABC', locationReference: 'K-1234', startTime: '2026-10-09T14:00:00Z' }) }));
    expect(result.structuredContent).toMatchObject({ id: 'a1', created: false });
    expect(result.content).toEqual([{ type: 'text', text: 'Activation folder a1 reused. No POTA spot was sent.' }]);
  });

  it('binds explicit deletion confirmation to the requested contact ID', async () => {
    const { client, request } = await connect({ success: true, replayed: true }, ['delete']);
    const arguments_ = { qso_id: 'q1', confirmation: 'DELETE q2', idempotency_key: 'delete-1' };
    expect((await client.callTool({ name: 'delete_contact', arguments: arguments_ })).isError).toBe(true);
    expect(request).not.toHaveBeenCalled();
    const result = await client.callTool({ name: 'delete_contact', arguments: { ...arguments_, confirmation: 'DELETE q1' } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'DELETE', path: 'v1/contacts/q1', idempotencyKey: 'delete-1' }));
    expect(result.structuredContent).toEqual({ success: true, replayed: true });
  });

  it('keeps canonical error code, status and quota context while removing keys', async () => {
    const { client } = await connect({}, ['read'], () => {
      throw new ApiError({ status: 429, code: 'rate_limited', message: 'Retry htx_live_abcdefghijklmnopqrstuvwxyz', requestId: 'request-1', retryAfter: '30', details: { resetSeconds: 30, limit: 120, apiKey: 'secret', rawIp: '1.2.3.4' } });
    });
    const result = await client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ error: 'rate_limited', message: 'Retry [redacted]', status: 429, requestId: 'request-1', retryAfter: '30', details: { resetSeconds: 30, limit: 120 } });
  });

  it('does not expose transport causes or malformed response data', async () => {
    const { client } = await connect({}, ['read'], () => { throw new NetworkError('Bearer secret-token at private-ip'); });
    const error = await client.callTool({ name: 'whoami', arguments: {} });
    expect(JSON.stringify(error)).not.toContain('secret-token');
    const malformed = await connect({ privateToken: 'secret' });
    const result = await malformed.client.callTool({ name: 'whoami', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('privateToken');
  });
});
