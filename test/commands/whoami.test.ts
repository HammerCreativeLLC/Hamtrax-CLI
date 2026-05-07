import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandContext } from '../../src/commands/context.js';
import { registerWhoami } from '../../src/commands/whoami.js';
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

describe('whoami command', () => {
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

  it('renders human key/value output', async () => {
    const program = new Command('hamtrax');
    program.option('--json');
    const client: FakeClient = {
      request: vi.fn(async () => ({
        callsign: 'K1ABC',
        plan: 'paid',
        tier: 'elevated',
        nativeQsoCount: 42,
      })),
    };
    registerWhoami(program, makeCtx(client));
    await program.parseAsync(['whoami'], { from: 'user' });
    const out = writes.join('');
    expect(out).toContain('callsign');
    expect(out).toContain('K1ABC');
    expect(out).toContain('plan');
    expect(out).toContain('paid');
    expect(out).toContain('tier');
    expect(out).toContain('elevated');
    expect(out).toContain('42');
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: 'v1/whoami',
    });
  });

  it('renders JSON when --json is set on the root', async () => {
    const program = new Command('hamtrax');
    program.option('--json');
    const client: FakeClient = {
      request: vi.fn(async () => ({
        callsign: 'K1ABC',
        plan: 'free',
        tier: 'basic',
        nativeQsoCount: 5,
      })),
    };
    registerWhoami(program, makeCtx(client));
    await program.parseAsync(['--json', 'whoami'], { from: 'user' });
    const out = writes.join('').trim();
    expect(JSON.parse(out)).toEqual({
      callsign: 'K1ABC',
      plan: 'free',
      tier: 'basic',
      nativeQsoCount: 5,
    });
  });
});
