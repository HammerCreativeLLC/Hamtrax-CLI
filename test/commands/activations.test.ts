import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../../src/commands/context.js';
import { registerActivations } from '../../src/commands/activations.js';
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

describe('activations commands', () => {
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

  it('list passes inProgress=true and renders a table', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({
        items: [
          {
            id: 'a1',
            name: 'Park K-1234',
            callsign: 'K1ABC',
            locationReference: 'K-1234',
            startTime: '2026-05-07T12:00Z',
          },
        ],
      })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerActivations(program, makeCtx(client));
    await program.parseAsync(['activations', 'list', '--in-progress'], {
      from: 'user',
    });
    const arg = client.request.mock.calls[0]![0];
    expect(arg.path).toBe('v1/activations');
    expect(arg.query).toEqual({ inProgress: true });
    const out = writes.join('');
    expect(out).toContain('Park K-1234');
  });

  it('create posts request and prints folder id (human)', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({
        id: 'fld_xyz',
        name: 'Park K-1234',
        autoFolderKey: 'POTA:K-1234',
        created: true,
      })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerActivations(program, makeCtx(client));
    await program.parseAsync(
      [
        'activations',
        'create',
        '--reference',
        'K-1234',
        '--callsign',
        'K1ABC',
        '--location-name',
        'Test Park',
      ],
      { from: 'user' },
    );
    const arg = client.request.mock.calls[0]![0];
    expect(arg.method).toBe('POST');
    expect(arg.path).toBe('v1/activations');
    expect(arg.body).toEqual({
      callsign: 'K1ABC',
      locationReference: 'K-1234',
      programId: 'POTA',
      locationName: 'Test Park',
    });
    const out = writes.join('');
    expect(out).toContain('K-1234');
    expect(out).toContain('fld_xyz');
    expect(out).toContain('started');
  });

  it('create --json emits the response object', async () => {
    const client: FakeClient = {
      request: vi.fn(async () => ({
        id: 'fld_xyz',
        name: 'Park K-1234',
        autoFolderKey: 'POTA:K-1234',
        created: false,
      })),
    };
    const program = new Command('hamtrax');
    program.option('--json');
    program.option('--ndjson');
    registerActivations(program, makeCtx(client));
    await program.parseAsync(
      [
        '--json',
        'activations',
        'create',
        '--reference',
        'K-1234',
        '--callsign',
        'K1ABC',
      ],
      { from: 'user' },
    );
    expect(JSON.parse(writes.join('').trim())).toEqual({
      id: 'fld_xyz',
      name: 'Park K-1234',
      autoFolderKey: 'POTA:K-1234',
      created: false,
    });
  });
});
