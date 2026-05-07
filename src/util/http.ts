/**
 * Tiny HTTP client around Node 20's built-in `fetch`. The CLI's only
 * caller of the network — both auth validation and command dispatch go
 * through here — so error mapping happens in exactly one place.
 *
 * Auth: every request gets `Authorization: Bearer <key>`. We never log the
 * key or echo it back into errors.
 *
 * Error envelope: server emits `{error, message, details, requestId}` per
 * plan §2h. We parse it and throw `ApiError`. If parsing fails (server
 * returned non-JSON, e.g. an LB-injected 502) we still throw `ApiError`
 * with status set so the exit-code mapper can land on `SERVER` / `GENERIC`.
 *
 * Transport failures (DNS, connect, abort) become `NetworkError` — that's
 * exit code 7, distinct from server-returned 5xx (exit 8).
 */

import type { ApiErrorEnvelope } from '../types.js';
import {
  ApiError,
  NetworkError,
  apiErrorFromEnvelope,
} from './errors.js';

export interface HttpClientOptions {
  apiBase: string;
  apiKey: string;
  /** Override fetch — used by tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** User-Agent header. Picked up by the server's audit log. */
  userAgent?: string;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path under the api base, leading slash optional. e.g. `v1/whoami`. */
  path: string;
  /** Querystring values — keys with undefined values are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Body JSON for POST/PUT. */
  body?: unknown;
  /** Optional AbortSignal hook. */
  signal?: AbortSignal;
}

export class HttpClient {
  private readonly apiBase: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: HttpClientOptions) {
    this.apiBase = opts.apiBase.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.userAgent = opts.userAgent ?? `hamtrax-cli/${process.version}`;
  }

  /** Build a final URL from base + path + query. */
  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const trimmed = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(`${this.apiBase}/${trimmed}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    const url = this.buildUrl(opts.path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      const init: RequestInit = {
        method: opts.method,
        headers,
      };
      if (body !== undefined) init.body = body;
      if (opts.signal !== undefined) init.signal = opts.signal;
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'fetch failed';
      throw new NetworkError(`Network request failed: ${msg}`, cause);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // Non-JSON body. Leave parsed undefined.
      }
    }

    if (!response.ok) {
      const envelope = isErrorEnvelope(parsed)
        ? parsed
        : ({
            error: response.status >= 500 ? 'internal' : 'error',
            message:
              typeof (parsed as { message?: unknown })?.message === 'string'
                ? (parsed as { message: string }).message
                : `HTTP ${response.status}`,
          } satisfies ApiErrorEnvelope);
      const retryAfter = response.headers.get('retry-after') ?? undefined;
      throw apiErrorFromEnvelope(response.status, envelope, retryAfter);
    }

    // 2xx with empty body — return empty object cast to T. Callers that
    // expect a real shape would have set a non-204 endpoint.
    if (parsed === undefined) {
      return {} as T;
    }
    return parsed as T;
  }
}

function isErrorEnvelope(v: unknown): v is ApiErrorEnvelope {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.error === 'string' && typeof o.message === 'string';
}

// Re-export ApiError for convenience (commands import the http client and
// usually want to test for ApiError on the same import path).
export { ApiError };
