import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ApiError, AuthMissingError, InvalidUsageError, NetworkError } from '../util/errors.js';

// Schemas are also the projection whitelist. Private account IDs, precise coordinates,
// credential fields, and unknown nested documents never enter MCP results.
export const whoamiOutput = z.object({
  callsign: z.string(),
  plan: z.enum(['free', 'paid']),
  tier: z.enum(['basic', 'elevated']),
  nativeQsoCount: z.number(),
});

const folderOutput = z.object({
  id: z.string(),
  name: z.string().optional(),
  autoFolderType: z.string().optional(),
  locationReference: z.string().optional(),
  locationName: z.string().optional(),
  programId: z.string().optional(),
  callsign: z.string().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  path: z.array(z.string()).max(50).optional(),
  qsoCount: z.number().optional(),
});

const contactOutput = z.object({
  id: z.string(),
  folderId: z.string().optional(),
  callsign: z.string().optional(),
  frequency: z.number().optional(),
  mode: z.string().optional(),
  timeOn: z.string().optional(),
  rstSent: z.string().optional(),
  rstReceived: z.string().optional(),
  notes: z.string().optional(),
  name: z.string().optional(),
  sig: z.string().optional(),
  sigInfo: z.string().optional(),
  mySig: z.string().optional(),
  mySigInfo: z.string().optional(),
  imported: z.boolean().optional(),
});

export const foldersOutput = z.object({
  items: z.array(folderOutput).max(200),
  cursor: z.string().optional(),
});
export const contactsOutput = z.object({
  items: z.array(contactOutput).max(200),
  cursor: z.string().optional(),
});
export const createContactOutput = z.object({ id: z.string(), replayed: z.boolean().optional() });
export const createActivationOutput = z.object({
  id: z.string(), name: z.string(), autoFolderKey: z.string(), created: z.boolean(),
});
export const deleteContactOutput = z.object({ success: z.literal(true), replayed: z.boolean().optional() });

const errorOutput = z.object({
  error: z.enum(['unauthorized', 'key_revoked', 'tier_insufficient', 'rate_limited', 'qso_cap_reached', 'not_found', 'validation_error', 'internal', 'network']),
  message: z.string(),
  status: z.number().optional(),
  requestId: z.string().optional(),
  retryAfter: z.string().optional(),
  details: z.object({
    resetSeconds: z.number().optional(), retryAfterSeconds: z.number().optional(),
    limit: z.number().optional(), current: z.number().optional(),
    supportRequired: z.literal(true).optional(), required: z.literal('elevated').optional(),
    reason: z.enum(['daily_logbook_budget', 'lifetime_logbook_budget', 'logbook_budget']).optional(),
  }).strict().optional(),
});

/** Include the canonical error alternative: clients also validate isError results. */
export function protocolOutputSchema(success: z.ZodObject) {
  const alternatives = z.union([success.strict(), errorOutput.strict()]);
  // SDK v1 requires an object validator at the root. Both the refinement and
  // advertised JSON Schema derive from these same success/error alternatives.
  const validator = success.partial().extend(errorOutput.partial().shape).strict().superRefine((value, context) => {
    if (!alternatives.safeParse(value).success) {
      context.addIssue({ code: 'custom', message: 'Expected a complete Hamtrax result or canonical error.' });
    }
  });
  const jsonSchema = { ...z.toJSONSchema(alternatives, { io: 'output' }), type: 'object' as const };
  return { validator, jsonSchema };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/\bhtx_(?:live|mcp|access|refresh|code)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]));
  }
  return value;
}

function normalizeWireTime(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const timestamp = value as Record<string, unknown>;
  const seconds = timestamp._seconds ?? timestamp.seconds;
  const nanoseconds = timestamp._nanoseconds ?? timestamp.nanoseconds ?? 0;
  if (typeof seconds !== 'number' || typeof nanoseconds !== 'number') return value;
  const milliseconds = seconds * 1000 + nanoseconds / 1000000;
  if (!Number.isFinite(milliseconds)) return value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeListTimes(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { items?: unknown }).items)) return raw;
  const envelope = raw as Record<string, unknown> & { items: unknown[] };
  return { ...envelope, items: envelope.items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const projected = { ...item } as Record<string, unknown>;
    for (const field of ['startTime', 'endTime', 'timeOn']) {
      if (field in projected) projected[field] = normalizeWireTime(projected[field]);
    }
    return projected;
  }) };
}

export function projectOutput(schema: z.ZodType, raw: unknown): Record<string, unknown> {
  // Zod's object parser strips fields outside the declared schema first.
  return sanitize(schema.parse(normalizeListTimes(raw))) as Record<string, unknown>;
}

export function successResult(text: string, output: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: redactSecrets(text) }], structuredContent: output };
}

const errorCodes = new Set([
  'unauthorized', 'key_revoked', 'tier_insufficient', 'rate_limited',
  'qso_cap_reached', 'not_found', 'validation_error', 'internal',
]);
const numericDetails = ['resetSeconds', 'retryAfterSeconds', 'limit', 'current'] as const;

export function errorResult(error: unknown): CallToolResult {
  const output: Record<string, unknown> = { error: 'internal', message: 'Hamtrax could not complete this request.' };
  if (error instanceof ApiError) {
    output.error = errorCodes.has(error.code) ? error.code : 'internal';
    output.message = redactSecrets(error.message).slice(0, 1000);
    output.status = error.status;
    if (error.requestId && /^[A-Za-z0-9_-]{1,100}$/.test(error.requestId)) output.requestId = error.requestId;
    if (error.retryAfter && /^\d{1,10}$/.test(error.retryAfter)) output.retryAfter = error.retryAfter;
    if (error.details && typeof error.details === 'object') {
      const input = error.details as Record<string, unknown>;
      const details: Record<string, unknown> = {};
      for (const key of numericDetails) {
        if (typeof input[key] === 'number' && Number.isFinite(input[key])) details[key] = input[key];
      }
      if (input.supportRequired === true) details.supportRequired = true;
      if (input.required === 'elevated') details.required = 'elevated';
      if (['daily_logbook_budget', 'lifetime_logbook_budget', 'logbook_budget'].includes(String(input.reason))) {
        details.reason = input.reason;
      }
      if (Object.keys(details).length > 0) output.details = details;
    }
  } else if (error instanceof AuthMissingError) {
    output.error = 'unauthorized';
    output.message = 'Configure your API key with hamtrax auth login, then retry.';
  } else if (error instanceof InvalidUsageError) {
    output.error = 'validation_error';
    output.message = redactSecrets(error.message);
  } else if (error instanceof NetworkError) {
    output.error = 'network';
    output.message = 'Hamtrax could not be reached. Retry with the same idempotency key for a mutation.';
  } else if (error instanceof z.ZodError) {
    output.message = 'Hamtrax returned an unexpected response.';
  }
  return { isError: true, content: [{ type: 'text', text: String(output.message) }], structuredContent: output };
}
