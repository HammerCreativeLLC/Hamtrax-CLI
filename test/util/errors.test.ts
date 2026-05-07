import { describe, it, expect } from 'vitest';

import {
  ApiError,
  AuthMissingError,
  EXIT_CODES,
  InvalidUsageError,
  NetworkError,
  apiErrorFromEnvelope,
  formatErrorForStderr,
  mapApiErrorToExitCode,
} from '../../src/util/errors.js';

describe('mapApiErrorToExitCode', () => {
  it('AuthMissingError → AUTH', () => {
    expect(mapApiErrorToExitCode(new AuthMissingError())).toBe(EXIT_CODES.AUTH);
  });

  it('InvalidUsageError → INVALID_USAGE', () => {
    expect(mapApiErrorToExitCode(new InvalidUsageError('bad'))).toBe(
      EXIT_CODES.INVALID_USAGE,
    );
  });

  it('NetworkError → NETWORK', () => {
    expect(mapApiErrorToExitCode(new NetworkError('oops'))).toBe(
      EXIT_CODES.NETWORK,
    );
  });

  it.each([
    ['unauthorized', EXIT_CODES.AUTH],
    ['key_revoked', EXIT_CODES.AUTH],
    ['tier_insufficient', EXIT_CODES.TIER_INSUFFICIENT],
    ['rate_limited', EXIT_CODES.RATE_LIMITED],
    ['qso_cap_reached', EXIT_CODES.QSO_CAP_REACHED],
    ['validation_error', EXIT_CODES.INVALID_USAGE],
    ['not_found', EXIT_CODES.GENERIC],
    ['internal', EXIT_CODES.SERVER],
  ])('server code %s → %i', (code, exit) => {
    const err = new ApiError({ status: 500, code, message: 'm' });
    expect(mapApiErrorToExitCode(err)).toBe(exit);
  });

  it.each([
    [401, EXIT_CODES.AUTH],
    [402, EXIT_CODES.QSO_CAP_REACHED],
    [403, EXIT_CODES.TIER_INSUFFICIENT],
    [404, EXIT_CODES.GENERIC],
    [400, EXIT_CODES.GENERIC],
    [429, EXIT_CODES.RATE_LIMITED],
    [500, EXIT_CODES.SERVER],
    [502, EXIT_CODES.SERVER],
  ])('status %i without code → %i', (status, exit) => {
    const err = new ApiError({ status, code: 'unknown_code', message: 'm' });
    expect(mapApiErrorToExitCode(err)).toBe(exit);
  });

  it('unknown errors → GENERIC', () => {
    expect(mapApiErrorToExitCode(new Error('plain'))).toBe(EXIT_CODES.GENERIC);
    expect(mapApiErrorToExitCode('string error')).toBe(EXIT_CODES.GENERIC);
    expect(mapApiErrorToExitCode(undefined)).toBe(EXIT_CODES.GENERIC);
  });
});

describe('formatErrorForStderr', () => {
  it('plain format includes command, code, message', () => {
    const err = new ApiError({
      status: 401,
      code: 'unauthorized',
      message: 'bad token',
    });
    expect(formatErrorForStderr({ command: 'whoami', err })).toBe(
      'hamtrax: whoami: unauthorized: bad token',
    );
  });

  it('plain format echoes Retry-After when 429', () => {
    const err = new ApiError({
      status: 429,
      code: 'rate_limited',
      message: 'slow down',
      retryAfter: '30',
    });
    expect(formatErrorForStderr({ command: 'contacts create', err })).toBe(
      'hamtrax: contacts create: rate_limited: slow down (retry after 30s)',
    );
  });

  it('json format is parseable and stable', () => {
    const err = new ApiError({
      status: 500,
      code: 'internal',
      message: 'kaboom',
      requestId: 'req_abc',
      details: { hint: 'retry' },
    });
    const out = formatErrorForStderr({ command: 'whoami', err, json: true });
    expect(JSON.parse(out)).toEqual({
      command: 'whoami',
      error: 'internal',
      message: 'kaboom',
      exitCode: EXIT_CODES.SERVER,
      status: 500,
      requestId: 'req_abc',
      details: { hint: 'retry' },
    });
  });

  it('json format for AuthMissingError', () => {
    const out = formatErrorForStderr({
      command: 'whoami',
      err: new AuthMissingError(),
      json: true,
    });
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe('auth_missing');
    expect(parsed.exitCode).toBe(EXIT_CODES.AUTH);
  });

  it('json format for NetworkError', () => {
    const out = formatErrorForStderr({
      command: 'whoami',
      err: new NetworkError('econnrefused'),
      json: true,
    });
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe('network');
    expect(parsed.exitCode).toBe(EXIT_CODES.NETWORK);
  });

  it('json format for InvalidUsageError', () => {
    const out = formatErrorForStderr({
      command: 'contacts create',
      err: new InvalidUsageError('--frequency required'),
      json: true,
    });
    const parsed = JSON.parse(out);
    expect(parsed.error).toBe('invalid_usage');
    expect(parsed.exitCode).toBe(EXIT_CODES.INVALID_USAGE);
  });
});

describe('apiErrorFromEnvelope', () => {
  it('builds an ApiError with all fields', () => {
    const err = apiErrorFromEnvelope(
      403,
      {
        error: 'tier_insufficient',
        message: 'upgrade required',
        details: { plan: 'free' },
        requestId: 'req_xyz',
      },
      undefined,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('tier_insufficient');
    expect(err.status).toBe(403);
    expect(err.requestId).toBe('req_xyz');
    expect(err.details).toEqual({ plan: 'free' });
  });

  it('attaches retryAfter when provided', () => {
    const err = apiErrorFromEnvelope(
      429,
      { error: 'rate_limited', message: 'slow' },
      '15',
    );
    expect(err.retryAfter).toBe('15');
  });
});
