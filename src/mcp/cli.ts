#!/usr/bin/env node
import { Command } from 'commander';
import { CLI_VERSION } from '../version.js';
import { mapApiErrorToExitCode } from '../util/errors.js';
import { redactSecrets } from './results.js';
import { startHamtraxMcpStdio } from './stdio.js';

const program = new Command('hamtrax-mcp')
  .description('Hamtrax MCP server over stdin/stdout. Only read tools are exposed by default.')
  .version(CLI_VERSION)
  .option('--api-base <url>', 'Override the Hamtrax API endpoint (or HAMTRAX_API_BASE).')
  .option('--allow-writes', 'Expose contact and activation creation tools.')
  .option('--allow-deletes', 'Expose contact deletion with an exact confirmation.')
  .action(async (options) => { await startHamtraxMcpStdio(options); });

void program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? redactSecrets(error.message) : 'Unable to start the MCP server.';
  process.stderr.write(`hamtrax-mcp: ${message}\n`);
  process.exitCode = mapApiErrorToExitCode(error);
});
