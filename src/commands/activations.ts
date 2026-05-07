/**
 * `hamtrax activations` — list active POTA-style activations and create
 * new ones. Creating an activation is "soft": the server upserts a folder
 * and returns its id; future contacts then reference that folder via
 * `--folder <id>`.
 */

import type { Command } from 'commander';

import type {
  CreateActivationRequest,
  CreateActivationResponse,
  FolderItem,
  PaginatedList,
} from '../types.js';
import {
  color,
  printJson,
  printNdjson,
  printTable,
} from '../util/output.js';
import type { CommandContext } from './context.js';
import { readGlobalOptions } from './context.js';

interface CreateOpts {
  reference: string;
  callsign: string;
  program?: string;
  locationName?: string;
  startTime?: string;
}

export function registerActivations(
  program: Command,
  ctx: CommandContext,
): void {
  const activations = program
    .command('activations')
    .description('List in-progress activations and start new ones.');

  activations
    .command('list')
    .description('List activations.')
    .option('--in-progress', 'Only show activations currently in progress.')
    .option('--json', 'Emit a single JSON object {items, cursor}.')
    .option('--ndjson', 'Emit one JSON object per line.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax activations list',
        '  $ hamtrax activations list --in-progress --json',
      ].join('\n'),
    )
    .action(async (opts: { inProgress?: boolean }, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      const client = await ctx.httpClient();
      const query: Record<string, string | boolean | undefined> = {};
      if (opts.inProgress) query.inProgress = true;
      const result = await client.request<PaginatedList<FolderItem>>({
        method: 'GET',
        path: 'v1/activations',
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
        { header: 'callsign', get: (r) => r.callsign },
        { header: 'locationReference', get: (r) => r.locationReference },
        { header: 'startTime', get: (r) => r.startTime },
        { header: 'endTime', get: (r) => r.endTime },
      ]);
    });

  activations
    .command('create')
    .description('Start (or upsert) an activation and return its folder id.')
    .requiredOption(
      '--reference <ref>',
      'Park/site reference, e.g. K-1234 for POTA.',
    )
    .requiredOption('--callsign <callsign>', 'Operator callsign.')
    .option('--program <id>', 'Program id (defaults to POTA).', 'POTA')
    .option('--location-name <name>', 'Human-readable location name.')
    .option('--start-time <iso>', 'ISO-8601 start time. Defaults to server time.')
    .option('--json', 'Emit JSON {id, name, autoFolderKey, created}.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax activations create --reference K-1234 --callsign K1ABC',
        '  $ hamtrax activations create --reference K-1234 --callsign K1ABC --location-name "Park Name" --json',
      ].join('\n'),
    )
    .action(async (opts: CreateOpts, cmd: Command) => {
      const global = readGlobalOptions(cmd);
      const body: CreateActivationRequest = {
        callsign: opts.callsign,
        locationReference: opts.reference,
      };
      if (opts.program !== undefined) body.programId = opts.program;
      if (opts.locationName !== undefined) body.locationName = opts.locationName;
      if (opts.startTime !== undefined) body.startTime = opts.startTime;

      const client = await ctx.httpClient();
      const result = await client.request<CreateActivationResponse>({
        method: 'POST',
        path: 'v1/activations',
        body,
      });
      if (global.json) {
        printJson(result);
        return;
      }
      const verb = result.created ? 'started' : 'resumed';
      process.stdout.write(
        `${color.green(`Activation ${verb}`)}: ${color.bold(opts.reference)} (folder: ${result.id}).\n`,
      );
    });
}
