import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../../src/commands/context.js';
import { registerFolders } from '../../src/commands/folders.js';
import { setColorEnabled } from '../../src/util/output.js';

interface FakeClient {
  request: ReturnType<typeof vi.fn>;
}

function makeCtx(client: FakeClient): CommandContext {
  return {
    httpClient: vi.fn(async () => client as never),
    globalOptions: () => ({
      json: false,
      ndjson: false,
      verbose: false,
      quiet: false,
      noColor: false,
    }),
    apiBase: () => 'https://example.test/cliApi',
  };
}

describe('folders commands', () => {
  let writes: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as never);
    setColorEnabled(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('list passes the type filter', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({ items: [] })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerFolders(program, makeCtx(client));
    await program.parseAsync(
      ['folders', 'list', '--type', 'activation'],
      { from: 'user' },
    );
    const arg = client.request.mock.calls[0]![0];
    expect(arg.path).toBe('v1/folders');
    expect(arg.query).toEqual({ type: 'activation' });
    expect(writes.join('')).toContain('(no rows)');
  });

  it('list rejects bogus --type', async () => {
    const client: FakeClient = { request: vi.fn() };
    const program = new Command('hamtrax');
    program.exitOverride();
    program.option('--json');
    program.option('--ndjson');
    registerFolders(program, makeCtx(client));
    await expect(
      program.parseAsync(['folders', 'list', '--type', 'nope'], {
        from: 'user',
      }),
    ).rejects.toThrow();
  });

  it('list --ndjson dumps items line-delimited', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({
        items: [
          { id: 'f1', name: 'One' },
          { id: 'f2', name: 'Two' },
        ],
      })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerFolders(program, makeCtx(client));
    await program.parseAsync(['--ndjson', 'folders', 'list'], {
      from: 'user',
    });
    const lines = writes.join('').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ id: 'f1', name: 'One' });
    expect(JSON.parse(lines[1]!)).toEqual({ id: 'f2', name: 'Two' });
  });

  it('show finds the folder via paged list', async () => {
    const client: FakeClient = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          items: [{ id: 'a' }, { id: 'b' }],
          cursor: 'p2',
        })
        .mockResolvedValueOnce({
          items: [{ id: 'c', name: 'Found', autoFolderType: 'activation' }],
        }),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerFolders(program, makeCtx(client));
    await program.parseAsync(['folders', 'show', 'c'], { from: 'user' });
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(writes.join('')).toContain('Found');
  });

  it('show throws when not found within page budget', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({ items: [], cursor: undefined })),
    };
    const program = new Command('hamtrax');
    program.exitOverride();
    program.option('--json');
    program.option('--ndjson');
    registerFolders(program, makeCtx(client));
    await expect(
      program.parseAsync(['folders', 'show', 'missing'], { from: 'user' }),
    ).rejects.toThrow();
  });
});
