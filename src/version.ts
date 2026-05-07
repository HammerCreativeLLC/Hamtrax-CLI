/**
 * Version constants for the CLI and the API contract it speaks.
 *
 * `CLI_VERSION` is read from package.json at runtime so a single source of
 * truth wins. We resolve relative to this file rather than `process.cwd()`
 * so the lookup works whether the package is run from `dist/` (bin) or via
 * `tsx` during development.
 *
 * `API_VERSION` is the path-segment version of the Cloud Functions surface
 * (`/v1/...`). It bumps independently of the CLI version and is exposed in
 * the `--help-json` manifest so an LLM can cache help output against the
 * specific server contract it was generated for.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const API_VERSION = 'v1';

function readCliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // From dist/version.js → ../package.json. From src/version.ts via tsx
    // → ../package.json. Same relative path either way.
    const pkgPath = resolve(here, '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to fallback.
  }
  return '0.0.0-dev';
}

export const CLI_VERSION = readCliVersion();
