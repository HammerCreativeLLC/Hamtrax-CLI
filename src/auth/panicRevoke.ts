/**
 * `hamtrax auth panic-revoke` — explicitly documented gap. Revoking a CLI
 * key requires Firebase Auth context (the user has to be signed in to the
 * web app) and that flow doesn't exist on the CLI surface yet. We surface
 * a clear pointer rather than silently failing or pretending success.
 *
 * Plan §4d.
 */

import { color } from '../util/output.js';

export async function runPanicRevoke(): Promise<void> {
  const lines = [
    color.yellow('Server-side key revocation is not available from the CLI.'),
    '',
    'API-key revocation requires Firebase Auth (web sign-in).',
    `Visit ${color.cyan('https://hamtrax.com/cli/security')} to revoke this key.`,
    '',
    `As a local-only fallback, run: ${color.bold('hamtrax auth logout')}`,
    '(This removes the key from this machine but does NOT invalidate it server-side.)',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}
