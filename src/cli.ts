#!/usr/bin/env node
/**
 * Hamtrax CLI entry point.
 *
 * Responsibilities:
 *   - Wire up Commander with global flags (--json, --ndjson, --verbose,
 *     --quiet, --api-base, --no-color).
 *   - Build a `CommandContext` that lazily resolves the API key on demand
 *     and constructs an HttpClient. `auth login` and `auth set-key` skip
 *     the lazy resolution because they're the commands that *create* the
 *     key in the first place.
 *   - Dispatch to leaf commands and shape any thrown error into the
 *     stable stderr format from `formatErrorForStderr`. Exit codes follow
 *     `mapApiErrorToExitCode` per plan §4g.
 *   - Provide LLM-friendly introspection: `--help-json` dumps a structured
 *     manifest, and `help --all` dumps every help page in one shot.
 *
 * Color and output rules:
 *   - `--no-color` disables color globally.
 *   - When stdout is not a TTY, color is also off (default in `output.ts`).
 *
 * Auth surface intentionally avoids any pre-hook key resolution: nothing
 * is fetched from keychain/file unless a command actually needs it. That
 * keeps `--help`, `--version`, `--help-json`, and `auth status (no key)`
 * working in environments without keychains or config dirs.
 */

import { Command, CommanderError } from 'commander';

import { runLogin } from './auth/login.js';
import { runLogout } from './auth/logout.js';
import { runPanicRevoke } from './auth/panicRevoke.js';
import { runSetKey } from './auth/setKey.js';
import { runStatus } from './auth/status.js';
import { getApiKey } from './auth/store.js';
import { registerActivations } from './commands/activations.js';
import { registerContacts } from './commands/contacts.js';
import type { CommandContext } from './commands/context.js';
import { readGlobalOptions } from './commands/context.js';
import { registerFolders } from './commands/folders.js';
import { registerWhoami } from './commands/whoami.js';
import { API_VERSION, CLI_VERSION } from './version.js';
import {
  EXIT_CODES,
  InvalidUsageError,
  formatErrorForStderr,
  mapApiErrorToExitCode,
} from './util/errors.js';
import { HttpClient } from './util/http.js';
import { printJson, setColorEnabled } from './util/output.js';

const DEFAULT_API_BASE =
  'https://us-central1-hamtrax.cloudfunctions.net/cliApi';

function resolveApiBase(rootCmd: Command): string {
  const opts = rootCmd.opts() as { apiBase?: string };
  if (opts.apiBase && opts.apiBase.length > 0) return opts.apiBase;
  const fromEnv = process.env.HAMTRAX_API_BASE;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return DEFAULT_API_BASE;
}

function buildContext(rootCmd: Command): CommandContext {
  return {
    async httpClient(explicitKey?: string): Promise<HttpClient> {
      const apiKey = explicitKey ?? (await getApiKey());
      return new HttpClient({
        apiBase: resolveApiBase(rootCmd),
        apiKey,
        userAgent: `hamtrax-cli/${CLI_VERSION} node/${process.version}`,
      });
    },
    globalOptions(cmd: Command) {
      return readGlobalOptions(cmd);
    },
    apiBase() {
      return resolveApiBase(rootCmd);
    },
  };
}

/**
 * Wrap a leaf-command async handler so any thrown error is shaped to the
 * stable stderr format and the process exits with the right code.
 */
function wrap(
  rootCmd: Command,
  command: string,
  handler: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    try {
      await handler();
    } catch (err) {
      const json = (rootCmd.opts() as { json?: boolean }).json === true;
      process.stderr.write(
        `${formatErrorForStderr({ command, err, json })}\n`,
      );
      process.exit(mapApiErrorToExitCode(err));
    }
  };
}

interface HelpJsonOption {
  flag: string;
  description: string;
  required: boolean;
  type: 'string' | 'boolean' | 'number';
}

interface HelpJsonCommand {
  name: string;
  description: string;
  options: HelpJsonOption[];
  examples: string[];
}

interface HelpJsonManifest {
  cli_version: string;
  api_version: string;
  api_base: string;
  exit_codes: Record<string, number>;
  commands: HelpJsonCommand[];
}

function inferOptionType(flags: string): 'string' | 'boolean' | 'number' {
  // Commander option flags look like `-y, --yes` or `--folder <id>`.
  if (/<[^>]+>|\[[^\]]+\]/.test(flags)) return 'string';
  return 'boolean';
}

function collectExamples(cmd: Command): string[] {
  // `addHelpText('after', ...)` content is emitted via Commander's
  // `afterHelp` event, NOT included in `cmd.helpInformation()`. To surface
  // it for the JSON manifest we drive `outputHelp` with a capture sink so
  // the events fire and we get the full rendered help including the
  // Examples block, then parse back the lines that start with `$ `.
  let captured = '';
  cmd.outputHelp({ write: (s: string) => { captured += s; } } as never);
  const idx = captured.indexOf('Examples:');
  if (idx === -1) return [];
  const lines = captured.slice(idx).split('\n').slice(1);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      // Blank line: end of the Examples block.
      if (out.length > 0) break;
      continue;
    }
    if (trimmed.startsWith('$ ')) {
      out.push(trimmed.slice(2));
    } else if (trimmed.startsWith('hamtrax')) {
      out.push(trimmed);
    }
  }
  return out;
}

function commandToManifest(cmd: Command, prefix: string[] = []): HelpJsonCommand[] {
  const out: HelpJsonCommand[] = [];
  const path = [...prefix, cmd.name()].join(' ');
  const options: HelpJsonOption[] = cmd.options.map((opt) => ({
    flag: opt.flags,
    description: opt.description ?? '',
    // Commander semantics: `mandatory` = the option itself must be passed
    // (set by `.requiredOption(...)`). `required` on the Option object
    // means the option *takes* a required value when present (i.e. `<arg>`
    // syntax in the flag string), which is not what consumers of this
    // manifest care about. Use `mandatory` for the manifest's
    // `required` field per plan §4e.
    required: opt.mandatory === true,
    type: inferOptionType(opt.flags),
  }));
  // Skip the root entry in the prefix walk; root has its own dump path.
  if (prefix.length > 0) {
    out.push({
      name: path,
      description: cmd.description() ?? '',
      options,
      examples: collectExamples(cmd),
    });
  }
  for (const sub of cmd.commands) {
    out.push(...commandToManifest(sub, prefix.length === 0 ? [cmd.name()] : [...prefix, cmd.name()]));
  }
  return out;
}

function dumpHelpJson(rootCmd: Command): void {
  const manifest: HelpJsonManifest = {
    cli_version: CLI_VERSION,
    api_version: API_VERSION,
    api_base: resolveApiBase(rootCmd),
    exit_codes: { ...EXIT_CODES },
    commands: commandToManifest(rootCmd),
  };
  printJson(manifest);
}

function dumpHelpAll(rootCmd: Command): void {
  const out: string[] = [];
  out.push(rootCmd.helpInformation());
  const walk = (cmd: Command, prefix: string[]): void => {
    for (const sub of cmd.commands) {
      const path = [...prefix, sub.name()];
      out.push(`\n=== hamtrax ${path.join(' ')} ===\n`);
      out.push(sub.helpInformation());
      walk(sub, path);
    }
  };
  walk(rootCmd, []);
  process.stdout.write(out.join('\n'));
}

export function buildProgram(): Command {
  const program = new Command('hamtrax');
  program
    .description(
      'Hamtrax CLI — log POTA contacts and manage activations from your terminal or AI agent.',
    )
    .version(CLI_VERSION, '-v, --version', 'Print CLI version.')
    .option('--json', 'Emit JSON (single object) where supported.')
    .option('--ndjson', 'Emit newline-delimited JSON (list commands only).')
    .option('--verbose', 'Verbose logging to stderr.')
    .option('--quiet', 'Suppress non-error stdout.')
    .option('--api-base <url>', `Override API base URL. Default: ${DEFAULT_API_BASE}`)
    .option('--no-color', 'Disable ANSI color in output.')
    .option('--help-json', 'Print a structured help manifest and exit.')
    .addHelpText(
      'after',
      [
        '',
        'Environment:',
        '  HAMTRAX_API_KEY     Bearer token (overrides keychain / config).',
        '  HAMTRAX_API_BASE    Override base URL.',
        '  HAMTRAX_NO_KEYRING  Set to 1 to disable keytar; use config file.',
        '',
        'Exit codes:',
        '  0 ok           1 generic       2 invalid usage',
        '  3 auth         4 rate-limited  5 tier insufficient',
        '  6 qso cap      7 network       8 server',
        '',
        'See `hamtrax help --all` for every subcommand at once, or',
        '`hamtrax --help-json` for a machine-readable manifest.',
      ].join('\n'),
    );
  program.exitOverride();
  program.showHelpAfterError();
  program.hook('preAction', () => {
    const opts = program.opts() as { color?: boolean; noColor?: boolean };
    if (opts.color === false || opts.noColor === true) setColorEnabled(false);
  });

  const ctx = buildContext(program);

  // -------- auth --------
  const auth = program
    .command('auth')
    .description('Manage the API key used by this CLI.');

  auth
    .command('login')
    .description('Interactively prompt for an API key and validate it.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax auth login',
        '  $ hamtrax auth login && hamtrax auth status --json',
      ].join('\n'),
    )
    .action(
      wrap(program, 'auth login', async () => {
        await runLogin((apiKey) => new HttpClient({
          apiBase: resolveApiBase(program),
          apiKey,
          userAgent: `hamtrax-cli/${CLI_VERSION} node/${process.version}`,
        }));
      }),
    );

  auth
    .command('set-key')
    .argument('[key]', 'API key. Reads from stdin if omitted.')
    .description('Persist an API key non-interactively (CI / scripting).')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax auth set-key htx_live_xxxxxxxx',
        '  $ cat key.txt | hamtrax auth set-key',
      ].join('\n'),
    )
    .action(
      (arg: string | undefined) =>
        wrap(program, 'auth set-key', async () => {
          await runSetKey(arg);
        })(),
    );

  auth
    .command('status')
    .description('Show where the active API key lives and call /v1/whoami.')
    .option('--json', 'Emit a single JSON object.')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax auth status',
        '  $ hamtrax auth status --json',
      ].join('\n'),
    )
    .action((_opts: unknown, cmd: Command) =>
      wrap(program, 'auth status', async () => {
        const global = readGlobalOptions(cmd);
        // runStatus only calls the factory when a key is actually
        // configured (source !== 'none'). Pre-resolve eagerly when we
        // can; otherwise pass a never-called placeholder.
        let client: HttpClient | undefined;
        try {
          client = await ctx.httpClient();
        } catch {
          // No key configured — runStatus will short-circuit on
          // source==='none' before touching the factory.
        }
        const factory = (): HttpClient => {
          if (!client) {
            throw new Error('internal: status factory called without a key');
          }
          return client;
        };
        await runStatus(factory, { json: global.json });
      })(),
    );

  auth
    .command('logout')
    .description('Remove the API key from this machine (does NOT revoke server-side).')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax auth logout',
        '  $ hamtrax auth logout && hamtrax auth status',
      ].join('\n'),
    )
    .action(
      wrap(program, 'auth logout', async () => {
        await runLogout();
      }),
    );

  auth
    .command('panic-revoke')
    .description('Explain how to revoke a key. (Server-side revocation needs the web app.)')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  $ hamtrax auth panic-revoke',
        '  # Remove the key locally, then visit the web app to revoke server-side:',
        '  $ hamtrax auth logout',
        '  # then open: https://hamtrax.com/cli/security',
      ].join('\n'),
    )
    .action(
      wrap(program, 'auth panic-revoke', async () => {
        await runPanicRevoke();
      }),
    );

  // -------- whoami / folders / contacts / activations --------
  registerWhoami(program, ctx);
  registerFolders(program, ctx);
  registerContacts(program, ctx);
  registerActivations(program, ctx);

  // -------- help --all --------
  program
    .command('help')
    .argument('[command...]', 'Show help for a sub-command, or pass --all.')
    .description('Show help. `help --all` dumps every command at once.')
    .option('--all', 'Print help for every command and subcommand.')
    .action((args: string[], opts: { all?: boolean }) => {
      if (opts.all) {
        dumpHelpAll(program);
        return;
      }
      if (!args || args.length === 0) {
        program.outputHelp();
        return;
      }
      // Walk to the requested subcommand.
      let target: Command | undefined = program;
      for (const name of args) {
        const next: Command | undefined = target?.commands.find(
          (c) => c.name() === name,
        );
        if (!next) {
          process.stderr.write(`hamtrax: help: unknown command '${args.join(' ')}'\n`);
          process.exit(EXIT_CODES.INVALID_USAGE);
          return;
        }
        target = next;
      }
      if (target) target.outputHelp();
    });

  return program;
}

function isHelpJsonRequest(argv: readonly string[]): boolean {
  return argv.includes('--help-json');
}

async function main(argv: readonly string[]): Promise<void> {
  const program = buildProgram();

  // --help-json is a discoverability shortcut for LLMs; handle it before
  // any auth/network resolution so an agent can crawl the surface.
  if (isHelpJsonRequest(argv)) {
    // Run a no-op preAction so --no-color still applies if combined.
    program.parseOptions([...argv]);
    dumpHelpJson(program);
    return;
  }

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (err) {
    const commandLabel = resolveInvokedCommandLabel(program);
    if (err instanceof CommanderError) {
      // Commander's own usage / version / help paths come through here.
      // Help / version exits with 0; usage errors with 1 by default — we
      // remap to 2 (INVALID_USAGE) per plan §4g.
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
        process.exit(EXIT_CODES.OK);
      }
      const usageErr = new InvalidUsageError(err.message);
      const json = (program.opts() as { json?: boolean }).json === true;
      process.stderr.write(
        `${formatErrorForStderr({ command: commandLabel, err: usageErr, json })}\n`,
      );
      process.exit(EXIT_CODES.INVALID_USAGE);
    }
    const json = (program.opts() as { json?: boolean }).json === true;
    process.stderr.write(
      `${formatErrorForStderr({ command: commandLabel, err, json })}\n`,
    );
    process.exit(mapApiErrorToExitCode(err));
  }
}

/**
 * Walk the parsed Command tree and return a "subcmd subsubcmd" label for
 * whichever leaf was actually invoked. Used in error formatting so an
 * AuthMissingError surfaced from `hamtrax whoami` reads
 * `hamtrax: whoami: ...` instead of `hamtrax: hamtrax: ...`.
 */
function resolveInvokedCommandLabel(program: Command): string {
  // Commander's `args` on each Command after parsing contains the args
  // that fell through to it. We descend by checking which immediate
  // child has `_actionResults` populated. Public API doesn't expose
  // that cleanly, so we use `getCommand` via name traversal of argv.
  // Practical heuristic: the first non-option argv token after the root
  // is the subcommand; the next is the sub-subcommand if the parent has
  // children.
  const tokens = process.argv.slice(2).filter((t) => !t.startsWith('-'));
  if (tokens.length === 0) return 'hamtrax';
  const parts: string[] = [];
  let node: Command | undefined = program;
  for (const token of tokens) {
    const child: Command | undefined = node?.commands.find(
      (c) => c.name() === token,
    );
    if (!child) break;
    parts.push(token);
    node = child;
  }
  return parts.length === 0 ? 'hamtrax' : parts.join(' ');
}

// argv[0] = node, argv[1] = script.
void main(process.argv.slice(2));
