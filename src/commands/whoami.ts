/**
 * `hamtrax whoami` — convenience top-level alias for `auth status` that
 * always hits `/v1/whoami`. Useful as a probe in scripts: 0 = key works,
 * non-zero = something to fix.
 */

import type { Command } from 'commander';

import type { WhoamiResponse } from '../types.js';
import { printJson, printKeyValue } from '../util/output.js';
import type { CommandContext } from './context.js';
import { readGlobalOptions } from './context.js';

export function registerWhoami(program: Command, ctx: CommandContext): void {
  program
    .command('whoami')
    .description('Show the identity associated with the active API key.')
    .option('--json', 'Emit a single JSON object.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax whoami',
        '  $ hamtrax whoami --json',
      ].join('\n'),
    )
    .action(async (_opts: unknown, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      const client = await ctx.httpClient();
      const whoami = await client.request<WhoamiResponse>({
        method: 'GET',
        path: 'v1/whoami',
      });
      if (global.json) {
        printJson(whoami);
        return;
      }
      printKeyValue([
        ['callsign', whoami.callsign],
        ['plan', whoami.plan],
        ['tier', whoami.tier],
        ['nativeQsoCount', whoami.nativeQsoCount],
      ]);
    });
}
