/**
 * Output helpers for the CLI. Plan §4f.
 *
 * Three modes (caller decides which to invoke):
 *   - `printJson(value)`   — single object, default for `--json`.
 *   - `printNdjson(items)` — one JSON per line, list-only for `--ndjson`.
 *   - `printTable(rows)`   — human, tabular. Default for lists.
 *
 * Color rule: `picocolors` auto-detects TTY, but Commander callers may set
 * `--no-color`, so we expose `setColorEnabled(false)` and route every styled
 * helper through `c()` which short-circuits when disabled.
 *
 * Output streams: data → stdout, warnings/diagnostics → stderr. The CLI
 * NEVER writes plaintext API keys to either stream — there are no helpers
 * here that take a key as input.
 */

import Table from 'cli-table3';
import pc from 'picocolors';

let colorEnabled = process.stdout.isTTY === true;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

/** Apply a picocolors styler iff color is currently enabled. */
function c(fn: (s: string) => string, value: string): string {
  return colorEnabled ? fn(value) : value;
}

export const color = {
  dim: (s: string): string => c(pc.dim, s),
  bold: (s: string): string => c(pc.bold, s),
  green: (s: string): string => c(pc.green, s),
  red: (s: string): string => c(pc.red, s),
  yellow: (s: string): string => c(pc.yellow, s),
  cyan: (s: string): string => c(pc.cyan, s),
};

/** Print a single JSON document followed by a newline. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Print one JSON-encoded item per line. List-mode output, suitable for
 * piping to `jq` or feeding into agent loops.
 */
export function printNdjson(items: readonly unknown[]): void {
  for (const item of items) {
    process.stdout.write(`${JSON.stringify(item)}\n`);
  }
}

export interface TableColumn<T> {
  header: string;
  /** Field accessor — return any printable value or undefined. */
  get: (row: T) => unknown;
  /** Optional column width hint (cli-table3 honors as max). */
  width?: number;
}

/**
 * Print a table to stdout. Empty data produces a single-line "(no rows)"
 * dim notice rather than an empty table — agents parsing stdout can still
 * detect it cheaply.
 */
export function printTable<T>(rows: readonly T[], columns: readonly TableColumn<T>[]): void {
  if (rows.length === 0) {
    process.stdout.write(`${color.dim('(no rows)')}\n`);
    return;
  }
  const table = new Table({
    head: columns.map((col) => color.bold(col.header)),
    style: { head: [], border: [] }, // disable cli-table3's own colors; we already gated.
    ...(columns.some((col) => col.width !== undefined) && {
      colWidths: columns.map((col) => col.width ?? null) as Array<number | null>,
    }),
  });
  for (const row of rows) {
    table.push(columns.map((col) => formatCell(col.get(row))));
  }
  process.stdout.write(`${table.toString()}\n`);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return color.dim('—');
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Print key/value pairs in a simple two-column human format. Used by
 * single-object commands like `whoami` and `folders show`.
 */
export function printKeyValue(pairs: ReadonlyArray<readonly [string, unknown]>): void {
  const widest = pairs.reduce((acc, [k]) => Math.max(acc, k.length), 0);
  for (const [k, v] of pairs) {
    const padded = k.padEnd(widest, ' ');
    process.stdout.write(`${color.bold(padded)}  ${formatCell(v)}\n`);
  }
}

/** Write a warning to stderr with consistent prefix. */
export function warn(msg: string): void {
  process.stderr.write(`${color.yellow('warning:')} ${msg}\n`);
}
