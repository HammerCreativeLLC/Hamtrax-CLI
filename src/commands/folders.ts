/**
 * `hamtrax folders` — list and inspect logging folders. The server doesn't
 * expose a single-folder GET, so `folders show <id>` runs a list query and
 * filters client-side.
 */

import type { Command } from 'commander';

import type { FolderItem, PaginatedList } from '../types.js';
import { InvalidUsageError } from '../util/errors.js';
import {
  printJson,
  printKeyValue,
  printNdjson,
  printTable,
} from '../util/output.js';
import type { CommandContext } from './context.js';
import { readGlobalOptions } from './context.js';

const VALID_TYPES = new Set(['activation', 'category', 'monthly']);

export function registerFolders(program: Command, ctx: CommandContext): void {
  const folders = program
    .command('folders')
    .description('List and inspect logging folders.');

  folders
    .command('list')
    .description('List folders, optionally filtered by type.')
    .option('--type <type>', 'Filter by folder type: activation|category|monthly.')
    .option('--json', 'Emit a single JSON object {items, cursor}.')
    .option('--ndjson', 'Emit one JSON object per line (list mode).')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax folders list',
        '  $ hamtrax folders list --type activation --json',
      ].join('\n'),
    )
    .action(async (opts: { type?: string }, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      if (opts.type && !VALID_TYPES.has(opts.type)) {
        throw new InvalidUsageError(
          `--type must be one of: activation, category, monthly. Got '${opts.type}'.`,
        );
      }
      const client = await ctx.httpClient();
      const query: Record<string, string | undefined> = {};
      if (opts.type) query.type = opts.type;
      const result = await client.request<PaginatedList<FolderItem>>({
        method: 'GET',
        path: 'v1/folders',
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
        { header: 'name', get: (r) => r.name },
        { header: 'type', get: (r) => r.autoFolderType },
        { header: 'locationReference', get: (r) => r.locationReference },
        { header: 'callsign', get: (r) => r.callsign },
        { header: 'startTime', get: (r) => r.startTime },
        { header: 'endTime', get: (r) => r.endTime },
      ]);
    });

  folders
    .command('show')
    .argument('<id>', 'Folder id.')
    .description('Show details for a single folder.')
    .option('--json', 'Emit a single JSON object.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax folders show abc123',
        '  $ hamtrax folders show abc123 --json',
      ].join('\n'),
    )
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      const client = await ctx.httpClient();
      // Server has no single-folder endpoint — list + filter. We page
      // through (cap 5 pages = 250 items) until we hit the id.
      let cursor: string | undefined;
      let found: FolderItem | undefined;
      for (let i = 0; i < 5 && !found; i++) {
        const query: Record<string, string | undefined> = {};
        if (cursor) query.cursor = cursor;
        const page = await client.request<PaginatedList<FolderItem>>({
          method: 'GET',
          path: 'v1/folders',
          query,
        });
        found = page.items.find((f) => f.id === id);
        if (found || !page.cursor) break;
        cursor = page.cursor;
      }

      if (!found) {
        throw new InvalidUsageError(`Folder '${id}' not found.`);
      }

      if (global.json) {
        printJson(found);
        return;
      }
      const pairs: Array<readonly [string, unknown]> = [
        ['id', found.id],
        ['name', found.name],
        ['autoFolderType', found.autoFolderType],
        ['autoFolderKey', found.autoFolderKey],
        ['locationReference', found.locationReference],
        ['callsign', found.callsign],
        ['startTime', found.startTime],
        ['endTime', found.endTime],
      ];
      printKeyValue(pairs);
    });
}
