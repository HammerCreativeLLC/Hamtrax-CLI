/**
 * Local logout — removes the key from every storage backend. Does NOT
 * revoke server-side; use the web app for that (see `panicRevoke.ts`).
 */

import { color } from '../util/output.js';
import { clearApiKey } from './store.js';

export async function runLogout(): Promise<void> {
  await clearApiKey();
  process.stdout.write(`${color.green('Removed.')}\n`);
}
