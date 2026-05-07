import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../../src/commands/context.js';
import { registerContacts } from '../../src/commands/contacts.js';
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

describe('contacts commands', () => {
  let writes: string[];
  let errs: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writes = [];
    errs = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      }) as never);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown) => {
        errs.push(String(chunk));
        return true;
      }) as never);
    setColorEnabled(false);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('list paginates with limit + cursor + folder', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({
        items: [
          {
            id: 'q1',
            callsign: 'K2XYZ',
            frequency: 14.074,
            mode: 'FT8',
            timeOn: '2026-05-07T00:00:00Z',
          },
        ],
        cursor: 'next123',
      })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerContacts(program, makeCtx(client));
    await program.parseAsync(
      [
        '--ndjson',
        'contacts',
        'list',
        '--folder',
        'fld_abc',
        '--limit',
        '50',
        '--cursor',
        'prev',
      ],
      { from: 'user' },
    );
    const arg = client.request.mock.calls[0]![0];
    expect(arg.method).toBe('GET');
    expect(arg.path).toBe('v1/folders/fld_abc/contacts');
    expect(arg.query).toEqual({ limit: 50, cursor: 'prev' });
    const out = writes.join('').trim();
    expect(JSON.parse(out)).toEqual({
      id: 'q1',
      callsign: 'K2XYZ',
      frequency: 14.074,
      mode: 'FT8',
      timeOn: '2026-05-07T00:00:00Z',
    });
  });

  it('list rejects non-positive --limit', async () => {
    const client: FakeClient = { request: vi.fn() };
    const program = new Command('hamtrax');
    program.exitOverride();
    program.option('--json');
    program.option('--ndjson');
    registerContacts(program, makeCtx(client));
    await expect(
      program.parseAsync(
        ['contacts', 'list', '--folder', 'f', '--limit', '0'],
        { from: 'user' },
      ),
    ).rejects.toThrow();
  });

  it('create defaults timeOn to now and posts the body', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({ id: 'q_new' })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerContacts(program, makeCtx(client));
    const before = Date.now();
    await program.parseAsync(
      [
        '--json',
        'contacts',
        'create',
        '--folder',
        'fld_x',
        '--callsign',
        'K1ABC',
        '--frequency',
        '14.074',
        '--mode',
        'FT8',
      ],
      { from: 'user' },
    );
    const after = Date.now();
    const arg = client.request.mock.calls[0]![0];
    expect(arg.method).toBe('POST');
    expect(arg.path).toBe('v1/contacts');
    expect(arg.body.folderId).toBe('fld_x');
    expect(arg.body.callsign).toBe('K1ABC');
    expect(arg.body.frequency).toBe(14.074);
    expect(arg.body.mode).toBe('FT8');
    const ts = Date.parse(arg.body.timeOn);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(JSON.parse(writes.join('').trim())).toEqual({ id: 'q_new' });
  });

  it('create rejects bad frequency', async () => {
    const client: FakeClient = { request: vi.fn() };
    const program = new Command('hamtrax');
    program.exitOverride();
    program.option('--json');
    program.option('--ndjson');
    registerContacts(program, makeCtx(client));
    await expect(
      program.parseAsync(
        [
          'contacts',
          'create',
          '--folder',
          'f',
          '--callsign',
          'K',
          '--frequency',
          'banana',
          '--mode',
          'SSB',
        ],
        { from: 'user' },
      ),
    ).rejects.toThrow();
    expect(client.request).not.toHaveBeenCalled();
  });

  it('delete with --yes skips the prompt', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({ success: true })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    const promptConfirm = vi.fn(async () => true);
    registerContacts(program, makeCtx(client), { promptConfirm });
    await program.parseAsync(
      ['contacts', 'delete', 'q1', '--yes'],
      { from: 'user' },
    );
    expect(promptConfirm).not.toHaveBeenCalled();
    const arg = client.request.mock.calls[0]![0];
    expect(arg.method).toBe('DELETE');
    expect(arg.path).toBe('v1/contacts/q1');
  });

  it('delete without --yes calls the prompt and aborts on no', async () => {
    const client: FakeClient = { request: vi.fn() };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    const promptConfirm = vi.fn(async () => false);
    registerContacts(program, makeCtx(client), { promptConfirm });
    await program.parseAsync(['contacts', 'delete', 'q1'], { from: 'user' });
    expect(promptConfirm).toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalled();
    expect(writes.join('')).toContain('Cancelled');
  });

  it('delete --json --yes returns success object', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({ success: true })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerContacts(program, makeCtx(client));
    await program.parseAsync(
      ['--json', 'contacts', 'delete', 'q1', '--yes'],
      { from: 'user' },
    );
    expect(JSON.parse(writes.join('').trim())).toEqual({
      id: 'q1',
      success: true,
    });
  });
});
