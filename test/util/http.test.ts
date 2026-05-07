import { describe, it, expect, vi } from 'vitest';

import { ApiError, NetworkError } from '../../src/util/errors.js';
import { HttpClient } from '../../src/util/http.js';

function makeResponse(opts: {
  status: number;
  body?: unknown;
  text?: string;
  retryAfter?: string;
}): Response {
  const headers = new Headers();
  if (opts.retryAfter !== undefined) headers.set('retry-after', opts.retryAfter);
  const text =
    opts.text !== undefined
      ? opts.text
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : '';
  return new Response(text, { status: opts.status, headers });
}

describe('HttpClient.request', () => {
  it('parses 200 ok body', async () => {
    const fetchImpl = vi.fn(
      async () => makeResponse({ status: 200, body: { ok: true } }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'htx_live_key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await c.request<{ ok: boolean }>({
      method: 'GET',
      path: 'v1/whoami',
    });
    expect(out).toEqual({ ok: true });
    const call = fetchImpl.mock.calls[0]!;
    const url = call[0] as string;
    expect(url).toBe('https://api.example.com/cliApi/v1/whoami');
    const init = call[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer htx_live_key');
    expect(headers['User-Agent']).toMatch(/hamtrax-cli/);
    expect(headers.Accept).toBe('application/json');
  });

  it('returns {} for 200 with empty body', async () => {
    const fetchImpl = vi.fn(
      async () => makeResponse({ status: 200, text: '' }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await c.request<Record<string, unknown>>({
      method: 'GET',
      path: 'v1/empty',
    });
    expect(out).toEqual({});
  });

  it('builds query strings and skips undefined values', async () => {
    const fetchImpl = vi.fn(
      async () => makeResponse({ status: 200, body: { items: [] } }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await c.request({
      method: 'GET',
      path: '/v1/folders',
      query: { type: 'activation', limit: 50, cursor: undefined, on: true },
    });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('type=activation');
    expect(url).toContain('limit=50');
    expect(url).toContain('on=true');
    expect(url).not.toContain('cursor=');
  });

  it('serializes body and sets Content-Type for POST', async () => {
    const fetchImpl = vi.fn(
      async () => makeResponse({ status: 200, body: { id: 'q1' } }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await c.request({
      method: 'POST',
      path: 'v1/contacts',
      body: { callsign: 'K1ABC' },
    });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"callsign":"K1ABC"}');
  });

  it('throws ApiError with full envelope on 4xx', async () => {
    const fetchImpl = vi.fn(
      async () =>
        makeResponse({
          status: 401,
          body: {
            error: 'unauthorized',
            message: 'bad key',
            requestId: 'req_1',
          },
        }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      c.request({ method: 'GET', path: 'v1/whoami' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthorized',
      message: 'bad key',
      requestId: 'req_1',
    });
  });

  it('throws ApiError with code "internal" on 5xx non-JSON body', async () => {
    const fetchImpl = vi.fn(
      async () =>
        makeResponse({ status: 502, text: '<html>Bad Gateway</html>' }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let caught: unknown;
    try {
      await c.request({ method: 'GET', path: 'v1/whoami' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const e = caught as ApiError;
    expect(e.status).toBe(502);
    expect(e.code).toBe('internal');
  });

  it('attaches retry-after on 429', async () => {
    const fetchImpl = vi.fn(
      async () =>
        makeResponse({
          status: 429,
          body: { error: 'rate_limited', message: 'slow down' },
          retryAfter: '42',
        }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let caught: unknown;
    try {
      await c.request({ method: 'GET', path: 'v1/whoami' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const e = caught as ApiError;
    expect(e.retryAfter).toBe('42');
  });

  it('wraps transport failures in NetworkError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    let caught: unknown;
    try {
      await c.request({ method: 'GET', path: 'v1/whoami' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkError);
  });

  it('strips trailing slash from apiBase', async () => {
    const fetchImpl = vi.fn(
      async () => makeResponse({ status: 200, body: {} }),
    );
    const c = new HttpClient({
      apiBase: 'https://api.example.com/cliApi////',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await c.request({ method: 'GET', path: '/v1/x' });
    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toBe('https://api.example.com/cliApi/v1/x');
  });
});
