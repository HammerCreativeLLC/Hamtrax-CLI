/**
 * `hamtrax auth status` — shows where the active key lives (env / keychain
 * / file / none), its 12-char prefix (safe to print), and, if a key is
 * available, the resolved identity from `/v1/whoami`. Network call is
 * skipped when no key is configured so this command is always non-blocking.
 */

import type { WhoamiResponse } from '../types.js';
import { ApiError } from '../util/errors.js';
import type { HttpClient } from '../util/http.js';
import { color, printJson, printKeyValue, warn } from '../util/output.js';
import { getStorageStatus } from './store.js';

export type HttpClientFactory = () => HttpClient;

export interface RunStatusOptions {
  json?: boolean;
}

export async function runStatus(
  factory: HttpClientFactory,
  options: RunStatusOptions = {},
): Promise<void> {
  const status = await getStorageStatus();

  if (status.source === 'none') {
    if (options.json) {
      printJson({ source: 'none' });
      return;
    }
    process.stdout.write(
      `${color.yellow('Not logged in.')} Run \`hamtrax auth login\`.\n`,
    );
    return;
  }

  let whoami: WhoamiResponse | undefined;
  let whoamiError: string | undefined;
  try {
    const client = factory();
    whoami = await client.request<WhoamiResponse>({
      method: 'GET',
      path: 'v1/whoami',
    });
  } catch (err) {
    whoamiError =
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
  }

  if (options.json) {
    const payload: Record<string, unknown> = {
      source: status.source,
      keyPrefix: status.keyPrefix,
    };
    if (whoami) payload.whoami = whoami;
    if (whoamiError) payload.whoamiError = whoamiError;
    printJson(payload);
    return;
  }

  const pairs: Array<readonly [string, unknown]> = [
    ['source', status.source],
    ['keyPrefix', status.keyPrefix ?? '—'],
  ];
  if (whoami) {
    pairs.push(
      ['callsign', whoami.callsign],
      ['plan', whoami.plan],
      ['tier', whoami.tier],
      ['nativeQsoCount', whoami.nativeQsoCount],
    );
  }
  printKeyValue(pairs);
  if (whoamiError) warn(`whoami failed: ${whoamiError}`);
}
