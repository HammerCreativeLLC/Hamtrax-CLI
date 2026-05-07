import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before importing the module under test. Vitest
// hoists vi.mock calls to the top of the file.
const fakeKeytar = {
  getPassword: vi.fn<(s: string, a: string) => Promise<string | null>>(),
  setPassword: vi.fn<(s: string, a: string, v: string) => Promise<void>>(),
  deletePassword: vi.fn<(s: string, a: string) => Promise<boolean>>(),
};
let keytarShouldThrowOnImport = false;

vi.mock('keytar', () => {
  if (keytarShouldThrowOnImport) {
    throw new Error('binding missing');
  }
  return { default: fakeKeytar };
});

const fakeFs = {
  files: new Map<string, { contents: string; mode: number }>(),
  reset() {
    this.files.clear();
  },
};

vi.mock('node:fs', async () => {
  const real = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...real,
    promises: {
      mkdir: vi.fn(async (_path: string) => undefined),
      readFile: vi.fn(async (path: string) => {
        const entry = fakeFs.files.get(path);
        if (!entry) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return entry.contents;
      }),
      writeFile: vi.fn(
        async (
          path: string,
          data: string,
          opts: { mode?: number } | undefined,
        ) => {
          fakeFs.files.set(path, {
            contents: data,
            mode: opts?.mode ?? 0o644,
          });
        },
      ),
      chmod: vi.fn(async (path: string, mode: number) => {
        const entry = fakeFs.files.get(path);
        if (entry) entry.mode = mode;
      }),
      unlink: vi.fn(async (path: string) => {
        if (!fakeFs.files.has(path)) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        fakeFs.files.delete(path);
      }),
      stat: vi.fn(async (path: string) => {
        const entry = fakeFs.files.get(path);
        if (!entry) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
        return { mode: entry.mode };
      }),
      access: vi.fn(async (path: string) => {
        if (!fakeFs.files.has(path)) {
          const err = new Error('ENOENT') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        }
      }),
    },
    constants: real.constants,
  };
});

describe('auth/store', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    delete process.env.HAMTRAX_API_KEY;
    delete process.env.HAMTRAX_NO_KEYRING;
    fakeFs.reset();
    fakeKeytar.getPassword.mockReset();
    fakeKeytar.setPassword.mockReset();
    fakeKeytar.deletePassword.mockReset();
    keytarShouldThrowOnImport = false;
    // Reset module cache so the keytar dynamic-import memoisation in the
    // store doesn't carry over between tests.
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('getApiKey prefers env var over everything', async () => {
    process.env.HAMTRAX_API_KEY = 'env_key';
    fakeKeytar.getPassword.mockResolvedValue('keychain_key');
    const store = await import('../../src/auth/store.js');
    expect(await store.getApiKey()).toBe('env_key');
    expect(fakeKeytar.getPassword).not.toHaveBeenCalled();
  });

  it('getApiKey falls back to keychain when env is unset', async () => {
    fakeKeytar.getPassword.mockResolvedValue('keychain_key');
    const store = await import('../../src/auth/store.js');
    expect(await store.getApiKey()).toBe('keychain_key');
    expect(fakeKeytar.getPassword).toHaveBeenCalledWith('hamtrax-cli', 'default');
  });

  it('getApiKey falls back to file when keychain returns null', async () => {
    fakeKeytar.getPassword.mockResolvedValue(null);
    const store = await import('../../src/auth/store.js');
    const path = store.__paths.configPath();
    fakeFs.files.set(path, {
      contents: JSON.stringify({ apiKey: 'file_key' }),
      mode: 0o600,
    });
    expect(await store.getApiKey()).toBe('file_key');
  });

  it('getApiKey throws AuthMissingError when nothing is configured', async () => {
    fakeKeytar.getPassword.mockResolvedValue(null);
    const store = await import('../../src/auth/store.js');
    // Re-import the error class via the same module graph as `store`
    // (vi.resetModules between tests gives us fresh instances; identity
    // checks only line up when both come from the post-reset graph).
    const errors = await import('../../src/util/errors.js');
    await expect(store.getApiKey()).rejects.toBeInstanceOf(
      errors.AuthMissingError,
    );
  });

  it('HAMTRAX_NO_KEYRING=1 skips keychain and goes straight to file', async () => {
    process.env.HAMTRAX_NO_KEYRING = '1';
    fakeKeytar.getPassword.mockResolvedValue('keychain_key'); // should be ignored
    const store = await import('../../src/auth/store.js');
    const path = store.__paths.configPath();
    fakeFs.files.set(path, {
      contents: JSON.stringify({ apiKey: 'file_key' }),
      mode: 0o600,
    });
    expect(await store.getApiKey()).toBe('file_key');
    expect(fakeKeytar.getPassword).not.toHaveBeenCalled();
  });

  it('setApiKey writes to keychain when available', async () => {
    fakeKeytar.setPassword.mockResolvedValue(undefined);
    const store = await import('../../src/auth/store.js');
    const result = await store.setApiKey('htx_live_abc');
    expect(result.stored).toBe('keychain');
    expect(result.warning).toBeUndefined();
    expect(fakeKeytar.setPassword).toHaveBeenCalledWith(
      'hamtrax-cli',
      'default',
      'htx_live_abc',
    );
  });

  it('setApiKey falls back to file when keychain throws', async () => {
    fakeKeytar.setPassword.mockRejectedValue(new Error('no service'));
    const store = await import('../../src/auth/store.js');
    const result = await store.setApiKey('htx_live_abc');
    expect(result.stored).toBe('file');
    expect(result.warning).toMatch(/Keychain unavailable/);
    const path = store.__paths.configPath();
    const entry = fakeFs.files.get(path);
    expect(entry).toBeDefined();
    expect(entry!.mode).toBe(0o600);
    expect(JSON.parse(entry!.contents)).toEqual({ apiKey: 'htx_live_abc' });
  });

  it('setApiKey rejects empty keys', async () => {
    const store = await import('../../src/auth/store.js');
    await expect(store.setApiKey('')).rejects.toThrow();
  });

  it('clearApiKey removes from both backends', async () => {
    fakeKeytar.deletePassword.mockResolvedValue(true);
    const store = await import('../../src/auth/store.js');
    const path = store.__paths.configPath();
    fakeFs.files.set(path, {
      contents: JSON.stringify({ apiKey: 'old' }),
      mode: 0o600,
    });
    await store.clearApiKey();
    expect(fakeKeytar.deletePassword).toHaveBeenCalled();
    expect(fakeFs.files.has(path)).toBe(false);
  });

  it('keyPrefixFor returns first 12 chars', async () => {
    const store = await import('../../src/auth/store.js');
    expect(store.keyPrefixFor('htx_live_abcdefghij')).toBe('htx_live_abc');
  });

  it('getStorageStatus reports source=env', async () => {
    process.env.HAMTRAX_API_KEY = 'htx_live_envkey';
    const store = await import('../../src/auth/store.js');
    const status = await store.getStorageStatus();
    expect(status.source).toBe('env');
    expect(status.keyPrefix).toBe('htx_live_env');
  });

  it('getStorageStatus reports source=keychain', async () => {
    fakeKeytar.getPassword.mockResolvedValue('htx_live_keychain123');
    const store = await import('../../src/auth/store.js');
    const status = await store.getStorageStatus();
    expect(status.source).toBe('keychain');
    expect(status.keyPrefix).toBe('htx_live_key');
  });

  it('getStorageStatus reports source=file', async () => {
    fakeKeytar.getPassword.mockResolvedValue(null);
    const store = await import('../../src/auth/store.js');
    const path = store.__paths.configPath();
    fakeFs.files.set(path, {
      contents: JSON.stringify({ apiKey: 'htx_live_file12345' }),
      mode: 0o600,
    });
    const status = await store.getStorageStatus();
    expect(status.source).toBe('file');
    expect(status.keyPrefix).toBe('htx_live_fil');
  });

  it('getStorageStatus reports source=none', async () => {
    fakeKeytar.getPassword.mockResolvedValue(null);
    const store = await import('../../src/auth/store.js');
    const status = await store.getStorageStatus();
    expect(status.source).toBe('none');
    expect(status.keyPrefix).toBeUndefined();
  });
});
