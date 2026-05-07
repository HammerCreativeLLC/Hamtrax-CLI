/**
 * Error classification + exit-code mapping for the CLI. Plan §4g.
 *
 * Exit code table (also surfaced in `--help-json`):
 *   0  ok
 *   1  generic
 *   2  invalid usage (Commander pre-flight, bad arg)
 *   3  auth (missing/expired/revoked key)
 *   4  rate-limited (echo Retry-After)
 *   5  tier insufficient
 *   6  qso_cap_reached
 *   7  network / transport
 *   8  server (5xx)
 *
 * Stable stderr format (plan §4e):
 *   hamtrax: <command>: <error_code>: <message>
 * or `--json`:
 *   {"command": "...", "error": "...", "message": "...", "exitCode": N, ...}
 */

import type { ApiErrorEnvelope, ServerErrorCode } from '../types.js';

export const EXIT_CODES = {
  OK: 0,
  GENERIC: 1,
  INVALID_USAGE: 2,
  AUTH: 3,
  RATE_LIMITED: 4,
  TIER_INSUFFICIENT: 5,
  QSO_CAP_REACHED: 6,
  NETWORK: 7,
  SERVER: 8,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/** Thrown by the http client when the server returns a non-2xx. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;
  /** Server's `Retry-After` header value when status is 429. Seconds, string. */
  readonly retryAfter?: string;

  constructor(opts: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    retryAfter?: string;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    if (opts.details !== undefined) this.details = opts.details;
    if (opts.requestId !== undefined) this.requestId = opts.requestId;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
  }
}

/** Thrown when no API key is available via env / keychain / config. */
export class AuthMissingError extends Error {
  constructor(message = 'No API key configured. Run `hamtrax auth login`.') {
    super(message);
    this.name = 'AuthMissingError';
  }
}

/** Thrown for transport-layer failures (DNS, connect, TLS, etc.). */
export class NetworkError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** Thrown when Commander/our own arg parsing finds invalid input. */
export class InvalidUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUsageError';
  }
}

/**
 * Map an unknown error → CLI exit code per plan §4g. The mapping is
 * deterministic so AI agents can rely on the codes without parsing
 * messages.
 */
export function mapApiErrorToExitCode(err: unknown): ExitCode {
  if (err instanceof AuthMissingError) return EXIT_CODES.AUTH;
  if (err instanceof InvalidUsageError) return EXIT_CODES.INVALID_USAGE;
  if (err instanceof NetworkError) return EXIT_CODES.NETWORK;

  if (err instanceof ApiError) {
    // Server `error` code wins when set; fall back to status family.
    const code = err.code as ServerErrorCode | string;
    switch (code) {
      case 'unauthorized':
      case 'key_revoked':
        return EXIT_CODES.AUTH;
      case 'tier_insufficient':
        return EXIT_CODES.TIER_INSUFFICIENT;
      case 'rate_limited':
        return EXIT_CODES.RATE_LIMITED;
      case 'qso_cap_reached':
        return EXIT_CODES.QSO_CAP_REACHED;
      case 'validation_error':
        return EXIT_CODES.INVALID_USAGE;
      case 'not_found':
        return EXIT_CODES.GENERIC;
      case 'internal':
        return EXIT_CODES.SERVER;
    }

    // Status-family fallback when the server didn't supply a known code.
    if (err.status === 401) return EXIT_CODES.AUTH;
    if (err.status === 403) return EXIT_CODES.TIER_INSUFFICIENT;
    if (err.status === 429) return EXIT_CODES.RATE_LIMITED;
    if (err.status === 402) return EXIT_CODES.QSO_CAP_REACHED;
    if (err.status === 400 || err.status === 404) return EXIT_CODES.GENERIC;
    if (err.status >= 500) return EXIT_CODES.SERVER;
    return EXIT_CODES.GENERIC;
  }

  return EXIT_CODES.GENERIC;
}

interface FormatOpts {
  command: string;
  err: unknown;
  json?: boolean;
}

/**
 * Format an error to a single string for stderr. The plain format is
 * stable (plan §4e); the `--json` form is intentionally simple so agents
 * can JSON.parse it.
 */
export function formatErrorForStderr({ command, err, json }: FormatOpts): string {
  const code =
    err instanceof ApiError
      ? err.code
      : err instanceof AuthMissingError
        ? 'auth_missing'
        : err instanceof NetworkError
          ? 'network'
          : err instanceof InvalidUsageError
            ? 'invalid_usage'
            : 'error';
  const message = err instanceof Error ? err.message : String(err);
  const exitCode = mapApiErrorToExitCode(err);

  if (json) {
    const payload: Record<string, unknown> = {
      command,
      error: code,
      message,
      exitCode,
    };
    if (err instanceof ApiError) {
      payload.status = err.status;
      if (err.requestId) payload.requestId = err.requestId;
      if (err.details !== undefined) payload.details = err.details;
      if (err.retryAfter !== undefined) payload.retryAfter = err.retryAfter;
    }
    return JSON.stringify(payload);
  }

  let line = `hamtrax: ${command}: ${code}: ${message}`;
  if (err instanceof ApiError && err.retryAfter !== undefined) {
    line += ` (retry after ${err.retryAfter}s)`;
  }
  return line;
}

/** Convert envelope JSON + status + Retry-After into an ApiError. */
export function apiErrorFromEnvelope(
  status: number,
  envelope: ApiErrorEnvelope,
  retryAfter?: string,
): ApiError {
  const opts: ConstructorParameters<typeof ApiError>[0] = {
    status,
    code: envelope.error,
    message: envelope.message,
  };
  if (envelope.details !== undefined) opts.details = envelope.details;
  if (envelope.requestId !== undefined) opts.requestId = envelope.requestId;
  if (retryAfter !== undefined) opts.retryAfter = retryAfter;
  return new ApiError(opts);
}
