/**
 * `hamtrax contacts` — list, create, and delete QSO contacts.
 *
 * - `contacts list --folder <id>` paginates through `/v1/folders/:id/contacts`
 *   with optional `--limit` / `--cursor`. Output: human table, `--json`
 *   `{items, cursor}`, or `--ndjson` one-per-line.
 * - `contacts create` posts to `/v1/contacts`. `timeOn` defaults to the
 *   current ISO-8601 timestamp when omitted so the common case of "log
 *   right now" is one flag short.
 * - `contacts delete <qsoId>` requires `--yes` or an interactive confirm.
 *   We use `@inquirer/prompts.confirm` so the CLI is consistent with auth.
 */

import { confirm } from '@inquirer/prompts';
import type { Command } from 'commander';

import type {
  ContactItem,
  CreateContactRequest,
  CreateContactResponse,
  DeleteContactResponse,
  PaginatedList,
} from '../types.js';
import { InvalidUsageError } from '../util/errors.js';
import {
  color,
  printJson,
  printNdjson,
  printTable,
} from '../util/output.js';
import type { CommandContext } from './context.js';
import { readGlobalOptions } from './context.js';

interface CreateOpts {
  callsign: string;
  frequency: string;
  mode: string;
  folder: string;
  rstSent?: string;
  rstReceived?: string;
  timeOn?: string;
  notes?: string;
  name?: string;
}

interface DeleteOpts {
  yes?: boolean;
  /** Test seam — bypass real prompt. */
  promptConfirm?: () => Promise<boolean>;
}

export interface ContactsTestSeams {
  /** Inject a confirmation function for `contacts delete` tests. */
  promptConfirm?: () => Promise<boolean>;
}

export function registerContacts(
  program: Command,
  ctx: CommandContext,
  seams: ContactsTestSeams = {},
): void {
  const contacts = program
    .command('contacts')
    .description('List, create, and delete QSO contacts.');

  contacts
    .command('list')
    .description('List contacts inside a folder.')
    .requiredOption('--folder <id>', 'Folder id to list contacts from.')
    .option('--limit <n>', 'Max contacts per page (server caps).')
    .option('--cursor <cursor>', 'Opaque cursor from a prior page.')
    .option('--json', 'Emit a single JSON object {items, cursor}.')
    .option('--ndjson', 'Emit one JSON object per line.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax contacts list --folder abc123',
        '  $ hamtrax contacts list --folder abc123 --limit 50 --ndjson',
      ].join('\n'),
    )
    .action(
      async (
        opts: { folder: string; limit?: string; cursor?: string },
        cmd: Command,
      ) => {
        const global = readGlobalOptions(cmd);
        const client = await ctx.httpClient();
        const query: Record<string, string | number | undefined> = {};
        if (opts.limit !== undefined) {
          const n = Number(opts.limit);
          if (!Number.isFinite(n) || n <= 0) {
            throw new InvalidUsageError(
              `--limit must be a positive integer, got '${opts.limit}'.`,
            );
          }
          query.limit = n;
        }
        if (opts.cursor) query.cursor = opts.cursor;
        const result = await client.request<PaginatedList<ContactItem>>({
          method: 'GET',
          path: `v1/folders/${encodeURIComponent(opts.folder)}/contacts`,
          query,
        });
        if (global.ndjson) {
          printNdjson(result.items);
          return;
        }
        if (global.json) {
          printJson(result);
          return;
        }
        printTable(result.items, [
          { header: 'id', get: (r) => r.id },
          { header: 'callsign', get: (r) => r.callsign },
          { header: 'frequency', get: (r) => r.frequency },
          { header: 'mode', get: (r) => r.mode },
          { header: 'timeOn', get: (r) => r.timeOn },
          { header: 'rstSent', get: (r) => r.rstSent },
          { header: 'rstReceived', get: (r) => r.rstReceived },
        ]);
      },
    );

  contacts
    .command('create')
    .description('Log a new QSO contact in a folder.')
    .requiredOption('--callsign <callsign>', 'Worked station callsign.')
    .requiredOption('--frequency <mhz>', 'Frequency in MHz (e.g. 14.074).')
    .requiredOption('--mode <mode>', 'Mode (SSB, CW, FT8, ...).')
    .requiredOption('--folder <id>', 'Folder id to log into.')
    .option('--rst-sent <rst>', 'RST sent.')
    .option('--rst-received <rst>', 'RST received.')
    .option(
      '--time-on <iso>',
      'ISO-8601 UTC timestamp. Defaults to now.',
    )
    .option('--notes <text>', 'Notes.')
    .option('--name <name>', "Operator's name.")
    .option('--json', 'Emit JSON {id}.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        "  $ hamtrax contacts create --folder abc --callsign K1ABC --frequency 14.074 --mode FT8",
        "  $ hamtrax contacts create --folder abc --callsign K1ABC --frequency 7.185 --mode SSB --rst-sent 59 --rst-received 59 --json",
      ].join('\n'),
    )
    .action(async (opts: CreateOpts, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      const freq = Number(opts.frequency);
      if (!Number.isFinite(freq) || freq <= 0) {
        throw new InvalidUsageError(
          `--frequency must be a positive number (MHz), got '${opts.frequency}'.`,
        );
      }
      const body: CreateContactRequest = {
        folderId: opts.folder,
        callsign: opts.callsign,
        frequency: freq,
        mode: opts.mode,
        timeOn: opts.timeOn ?? new Date().toISOString(),
      };
      if (opts.rstSent !== undefined) body.rstSent = opts.rstSent;
      if (opts.rstReceived !== undefined) body.rstReceived = opts.rstReceived;
      if (opts.notes !== undefined) body.notes = opts.notes;
      if (opts.name !== undefined) body.name = opts.name;

      const client = await ctx.httpClient();
      const created = await client.request<CreateContactResponse>({
        method: 'POST',
        path: 'v1/contacts',
        body,
      });
      if (global.json) {
        printJson(created);
        return;
      }
      process.stdout.write(
        `${color.green('Logged')} QSO ${color.bold(created.id)}.\n`,
      );
    });

  contacts
    .command('delete')
    .argument('<qsoId>', 'Contact id to delete.')
    .description('Delete a QSO contact. Asks to confirm unless --yes.')
    .option('-y, --yes', 'Skip the confirmation prompt.')
    .option('--json', 'Emit JSON {id, success}.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax contacts delete qso123 --yes',
        '  $ hamtrax contacts delete qso123 --json --yes',
      ].join('\n'),
    )
    .action(async (qsoId: string, opts: DeleteOpts, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      let proceed = opts.yes === true;
      if (!proceed) {
        const askFn =
          opts.promptConfirm ??
          seams.promptConfirm ??
          (() =>
            confirm({
              message: `Delete QSO ${qsoId}? This cannot be undone.`,
              default: false,
            }));
        proceed = await askFn();
      }
      if (!proceed) {
        if (global.json) {
          printJson({ id: qsoId, success: false, cancelled: true });
          return;
        }
        process.stdout.write(`${color.yellow('Cancelled.')}\n`);
        return;
      }
      const client = await ctx.httpClient();
      await client.request<DeleteContactResponse>({
        method: 'DELETE',
        path: `v1/contacts/${encodeURIComponent(qsoId)}`,
      });
      if (global.json) {
        printJson({ id: qsoId, success: true });
        return;
      }
      process.stdout.write(
        `${color.green('Deleted')} QSO ${color.bold(qsoId)}.\n`,
      );
    });
}
