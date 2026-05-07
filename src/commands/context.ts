/**
 * Command context — passed to each `register*` function from `cli.ts`.
 *
 * The context exposes:
 *   - `httpClient()`     → returns a configured `HttpClient`. Resolves
 *                          the API key on demand (env / keychain / file).
 *   - `globalOptions()`  → snapshot of `--json`, `--ndjson`, `--verbose`,
 *                          `--quiet` from the root program. Each command
 *                          calls this in its action handler so that flags
 *                          set on parent commands propagate.
 *   - `apiBase()`        → the resolved base URL (used in --help-json).
 *
 * This keeps `cli.ts` from having to thread fetch/factory plumbing
 * through every command file.
 */

import type { Command } from 'commander';

import type { HttpClient } from '../util/http.js';

export interface GlobalOptions {
  json: boolean;
  ndjson: boolean;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
}

export interface CommandContext {
  /**
   * Build an HttpClient. Throws AuthMissingError if no key is configured.
   * Optionally accepts an explicit key (used by `auth login` to validate
   * the just-entered key before persisting it).
   */
  httpClient(explicitKey?: string): Promise<HttpClient>;
  /** Snapshot of merged global options (root + subcommand). */
  globalOptions(cmd: Command): GlobalOptions;
  /** Resolved API base URL. */
  apiBase(): string;
}

export function readGlobalOptions(cmd: Command): GlobalOptions {
  // Walk up to the root program so `hamtrax --json contacts list` and
  // `hamtrax contacts list --json` both work. Commander stores opts on
  // whichever Command saw the flag.
  let current: Command | null = cmd;
  const merged: GlobalOptions = {
    json: false,
    ndjson: false,
    verbose: false,
    quiet: false,
    noColor: false,
  };
  while (current) {
    const opts = current.opts() as Partial<{
      json: boolean;
      ndjson: boolean;
      verbose: boolean;
      quiet: boolean;
      color: boolean;
      noColor: boolean;
    }>;
    if (opts.json) merged.json = true;
    if (opts.ndjson) merged.ndjson = true;
    if (opts.verbose) merged.verbose = true;
    if (opts.quiet) merged.quiet = true;
    // Commander's `--no-color` sets `color: false` on opts.
    if (opts.color === false) merged.noColor = true;
    if (opts.noColor === true) merged.noColor = true;
    current = current.parent;
  }
  return merged;
}
