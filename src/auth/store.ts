/**
 * API key resolution + storage. Plan §4d.
 *
 * Resolution order for `getApiKey`:
 *   1. `process.env.HAMTRAX_API_KEY` (highest priority — escape hatch for
 *      CI and ad-hoc agent invocations)
 *   2. OS keychain via `keytar` (skipped if `HAMTRAX_NO_KEYRING=1` or if
 *      keytar's native binary failed to load on this platform)
 *   3. `~/.config/hamtrax/config.json` (mode 0600, JSON: `{apiKey: "..."}`)
 *   4. throw `AuthMissingError` — caller maps to exit code 3
 *
 * Storage for `setApiKey`:
 *   - try keytar first
 *   - on failure (binary missing / permission / explicit opt-out) write
 *     the config file at mode 0600 and return a warning string
 *   - never echo the plaintext anywhere (no console.log of the key, no
 *     toString)
 *
 * Keytar is a native module; on hosts where the prebuilt binary is missing
 * (sandbox CI runners, some Linux distros) the dynamic import will throw.
 * We catch that exactly once and fall back permanently to file storage for
 * the lifetime of the process.
 */

import { promises as fs, constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { AuthMissingError } from '../util/errors.js';

const SERVICE_NAME = 'hamtrax-cli';
const ACCOUNT_NAME = 'default';

export type StorageSource = 'env' | 'keychain' | 'file' | 'none';

export interface SetKeyResult {
  stored: 'env' | 'keychain' | 'file';
  warning?: string;
}

export interface StorageStatus {
  source: StorageSource;
  keyPrefix?: string;
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarPromise: Promise<KeytarLike | null> | undefined;

/**
 * Lazily load keytar. Returns null if the user opted out via env var or
 * the native binary failed to load. Memoised so we only attempt the
 * dynamic import once per process.
 */
async function getKeytar(): Promise<KeytarLike | null> {
  if (process.env.HAMTRAX_NO_KEYRING === '1') return null;
  if (keytarPromise) return keytarPromise;
  keytarPromise = (async () => {
    try {
      const mod = (await import('keytar')) as
        | { default?: KeytarLike }
        | KeytarLike;
      const candidate =
        (mod as { default?: KeytarLike }).default ?? (mod as KeytarLike);
      if (
        candidate &&
        typeof candidate.getPassword === 'function' &&
        typeof candidate.setPassword === 'function' &&
        typeof candidate.deletePassword === 'function'
      ) {
        return candidate;
      }
      return null;
    } catch {
      return null;
    }
  })();
  return keytarPromise;
}

/** First 12 chars of the key — safe to display, identifies which key is in use. */
export function keyPrefixFor(plaintext: string): string {
  return plaintext.slice(0, 12);
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'hamtrax');
}

function configPath(): string {
  return join(configDir(), 'config.json');
}

interface ConfigFile {
  apiKey?: string;
}

async function readConfigFile(): Promise<ConfigFile | null> {
  try {
    const raw = await fs.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw) as ConfigFile;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function writeConfigFile(contents: ConfigFile): Promise<void> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const path = configPath();
  // Write then chmod — `writeFile` honours `mode` only on create, so we
  // chmod unconditionally to also fix existing-file permissions.
  await fs.writeFile(path, JSON.stringify(contents, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await fs.chmod(path, 0o600);
  } catch {
    // best-effort
  }
}

async function deleteConfigFile(): Promise<void> {
  try {
    await fs.unlink(configPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // best-effort
    }
  }
}

/**
 * Resolve the API key. See top-of-file for resolution order. Throws
 * `AuthMissingError` when nothing is configured.
 */
export async function getApiKey(): Promise<string> {
  const fromEnv = process.env.HAMTRAX_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const keytar = await getKeytar();
  if (keytar) {
    try {
      const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (stored && stored.length > 0) return stored;
    } catch {
      // Fall through to file.
    }
  }

  const cfg = await readConfigFile();
  if (cfg?.apiKey && cfg.apiKey.length > 0) return cfg.apiKey;

  throw new AuthMissingError();
}

/**
 * Persist the API key. Tries keychain, falls back to a 0600 config file
 * with a warning. Never logs `plaintext`.
 */
export async function setApiKey(plaintext: string): Promise<SetKeyResult> {
  if (!plaintext || plaintext.length === 0) {
    throw new Error('Empty API key.');
  }

  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, plaintext);
      return { stored: 'keychain' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown';
      await writeConfigFile({ apiKey: plaintext });
      return {
        stored: 'file',
        warning: `Keychain unavailable (${reason}); stored in ${configPath()} (mode 0600).`,
      };
    }
  }

  await writeConfigFile({ apiKey: plaintext });
  return {
    stored: 'file',
    warning: `Keychain unavailable; stored in ${configPath()} (mode 0600).`,
  };
}

/** Best-effort removal from every storage backend. */
export async function clearApiKey(): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    } catch {
      // best-effort
    }
  }
  await deleteConfigFile();
}

/**
 * Where is the active key coming from? Used by `auth status` to render
 * a non-secret summary without making network calls.
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  const fromEnv = process.env.HAMTRAX_API_KEY;
  if (fromEnv && fromEnv.length > 0) {
    return { source: 'env', keyPrefix: keyPrefixFor(fromEnv) };
  }

  const keytar = await getKeytar();
  if (keytar) {
    try {
      const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (stored && stored.length > 0) {
        return { source: 'keychain', keyPrefix: keyPrefixFor(stored) };
      }
    } catch {
      // Fall through to file.
    }
  }

  const cfg = await readConfigFile();
  if (cfg?.apiKey && cfg.apiKey.length > 0) {
    return { source: 'file', keyPrefix: keyPrefixFor(cfg.apiKey) };
  }

  return { source: 'none' };
}

/** Verify the file lives at mode 0600 — exposed for tests. */
export async function configFileExistsAndIsPrivate(): Promise<boolean> {
  try {
    const stat = await fs.stat(configPath());
    await fs.access(configPath(), fsConstants.R_OK);
    // Lower 9 bits = unix perms.
    const mode = stat.mode & 0o777;
    return mode === 0o600;
  } catch {
    return false;
  }
}

/** Exposed for tests/integration. */
export const __paths = {
  configDir,
  configPath,
  SERVICE_NAME,
  ACCOUNT_NAME,
};
