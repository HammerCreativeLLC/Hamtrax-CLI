/**
 * Non-interactive key import. Accepts either a CLI argument or stdin
 * (for `cat key.txt | hamtrax auth set-key -`). Validates the prefix
 * and persists. We deliberately do NOT call whoami — that's `auth login`'s
 * job. This command is for scripting where the caller has already
 * verified the key out of band.
 */

import { InvalidUsageError } from '../util/errors.js';
import { color, warn } from '../util/output.js';
import { setApiKey } from './store.js';

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', (err) => reject(err));
  });
}

export interface RunSetKeyOptions {
  /** Override stdin reader — used by tests. */
  readStdin?: () => Promise<string>;
}

export async function runSetKey(
  arg: string | undefined,
  options: RunSetKeyOptions = {},
): Promise<void> {
  let key: string | undefined = arg && arg.trim().length > 0 ? arg.trim() : undefined;
  if (!key) {
    if (process.stdin.isTTY) {
      throw new InvalidUsageError(
        'Provide the key as an argument or pipe it via stdin: `hamtrax auth set-key <key>` or `cat key.txt | hamtrax auth set-key -`.',
      );
    }
    const reader = options.readStdin ?? readStdin;
    key = (await reader()).trim();
  }

  if (!key || key.length === 0) {
    throw new InvalidUsageError('Empty API key.');
  }
  if (!key.startsWith('htx_live_') && !key.startsWith('htx_test_')) {
    throw new InvalidUsageError(
      'Key must start with `htx_live_` or `htx_test_`.',
    );
  }

  const result = await setApiKey(key);
  if (result.warning) warn(result.warning);
  process.stdout.write(
    `${color.green('Stored')} in ${result.stored}.\n`,
  );
}
