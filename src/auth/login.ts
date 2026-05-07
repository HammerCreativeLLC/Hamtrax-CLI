/**
 * Interactive login. Prompts for the API key (masked), validates it by
 * calling `/v1/whoami`, then persists via `setApiKey`. On 401 we exit 3.
 *
 * The factory pattern (`httpClientFactory`) lets the CLI inject the
 * configured base URL while keeping this module test-isolated — tests
 * pass in a fake HttpClient that returns a stubbed whoami response.
 */

import { password } from '@inquirer/prompts';

import type { WhoamiResponse } from '../types.js';
import { color, warn } from '../util/output.js';
import type { HttpClient } from '../util/http.js';
import { setApiKey } from './store.js';

export type HttpClientFactoryWithKey = (apiKey: string) => HttpClient;

export interface RunLoginOptions {
  /** Override prompt — used by tests. */
  promptApiKey?: () => Promise<string>;
}

export async function runLogin(
  factory: HttpClientFactoryWithKey,
  options: RunLoginOptions = {},
): Promise<void> {
  const prompt =
    options.promptApiKey ??
    (() =>
      password({
        message: 'Paste your htx_live_ API key:',
        mask: true,
        validate: (input: string) => {
          if (!input || input.length < 8) return 'Key looks too short.';
          if (!input.startsWith('htx_live_') && !input.startsWith('htx_test_')) {
            return 'Key should start with htx_live_ or htx_test_.';
          }
          return true;
        },
      }));

  const apiKey = await prompt();

  // Validate via whoami before persisting — refusing to store a bad key
  // is the difference between "auth login failed" and "every subsequent
  // command fails".
  const client = factory(apiKey);
  const whoami = await client.request<WhoamiResponse>({
    method: 'GET',
    path: 'v1/whoami',
  });

  const result = await setApiKey(apiKey);
  if (result.warning) warn(result.warning);

  process.stdout.write(
    `${color.green('Logged in')} as ${color.bold(whoami.callsign)} (tier: ${whoami.tier}).\n`,
  );
}
