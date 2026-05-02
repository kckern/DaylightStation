#!/usr/bin/env node
/**
 * dscli — DaylightStation CLI.
 *
 * Entry point. Parses argv, dispatches to cli/commands/<subcommand>.mjs via
 * dynamic import, exits with the command's returned exit code.
 *
 * See docs/superpowers/specs/2026-05-02-dscli-design.md for the full contract.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './_argv.mjs';
import { printError, EXIT_OK, EXIT_FAIL, EXIT_USAGE } from './_output.mjs';
import * as bootstrap from './_bootstrap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, 'commands');

// Subcommands wired up so far. Add to this list as new command modules land.
const KNOWN_SUBCOMMANDS = ['system', 'ha', 'content', 'memory', 'finance'];

function printTopLevelHelp(stdout) {
  stdout.write([
    'dscli — DaylightStation CLI',
    '',
    'Usage:',
    '  dscli <subcommand> [action] [args...] [--flags]',
    '  dscli --help',
    '  dscli <subcommand> --help',
    '',
    'Subcommands:',
    '  system    Health, config, reload',
    '  ha        Home Assistant entity state and control',
    '  content   Search and resolve media content',
    '  memory    Read concierge memory state',
    '  finance   Buxfer accounts and transactions',
    '',
    'Output:',
    '  JSON to stdout on success (exit 0).',
    '  JSON error to stderr on failure (exit 1+).',
    '',
    'See docs/superpowers/specs/2026-05-02-dscli-design.md for the full contract.',
    '',
  ].join('\n'));
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgv(argv);

  // Top-level --help or no args
  if (!parsed.subcommand) {
    printTopLevelHelp(process.stdout);
    process.exit(EXIT_OK);
  }

  if (parsed.help && !parsed.subcommand) {
    printTopLevelHelp(process.stdout);
    process.exit(EXIT_OK);
  }

  // --help with no subcommand already handled above; subcommand-level --help
  // is passed through to the command module.
  if (!KNOWN_SUBCOMMANDS.includes(parsed.subcommand)) {
    process.stderr.write(`dscli: unknown subcommand: ${parsed.subcommand}\n`);
    process.stderr.write(`Run \`dscli --help\` for the list of subcommands.\n`);
    process.exit(EXIT_USAGE);
  }

  // Dynamic import scopes startup cost to only the command being run.
  let mod;
  try {
    mod = await import(path.join(COMMANDS_DIR, `${parsed.subcommand}.mjs`));
  } catch (err) {
    printError(process.stderr, { error: 'subcommand_load_failed', subcommand: parsed.subcommand, message: err.message });
    process.exit(EXIT_FAIL);
  }

  const command = mod.default;
  if (!command || typeof command.run !== 'function') {
    printError(process.stderr, { error: 'invalid_command_module', subcommand: parsed.subcommand });
    process.exit(EXIT_FAIL);
  }

  // Build deps bag: real streams + bootstrap factories + global fetch.
  const deps = {
    stdout: process.stdout,
    stderr: process.stderr,
    fetch: globalThis.fetch,
    getConfigService: bootstrap.getConfigService,
    getHttpClient: bootstrap.getHttpClient,
    // Later tasks add: getHaGateway, getContentQuery, getMemory, getBuxfer
  };

  try {
    const result = await command.run(parsed, deps);
    const code = (result && typeof result.exitCode === 'number') ? result.exitCode : EXIT_OK;
    process.exit(code);
  } catch (err) {
    printError(process.stderr, err);
    process.exit(EXIT_FAIL);
  }
}

main();
