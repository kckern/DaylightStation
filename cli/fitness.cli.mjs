#!/usr/bin/env node

/**
 * Fitness CLI — one entry point for every fitness session and Strava operation.
 *
 * Replaces thirteen standalone scripts that each carried their own bootstrap,
 * their own argv parser, and (three times over) their own copy of the Strava
 * OAuth refresh logic. Commands live in `cli/lib/fitness/`, one module per
 * operation, each exporting `{ spec, run(argv, ctx) }`.
 *
 * Usage:
 *   node cli/fitness.cli.mjs <group> <command> [args]
 *   node cli/fitness.cli.mjs <command> [args]        (when unambiguous)
 *
 * Environment:
 *   DAYLIGHT_BASE_PATH   Override the data root (default: container path, else repo)
 *   DAYLIGHT_USER        Default Strava user (default: "user_1")
 *   DEBUG                Print stack traces on error
 *
 * @module cli/fitness
 */

import { getContext, CliError } from './lib/fitness/context.mjs';

import * as heal from './lib/fitness/heal.mjs';
import * as merge from './lib/fitness/merge.mjs';
import * as split from './lib/fitness/split.mjs';
import * as scan from './lib/fitness/scan.mjs';
import * as reconstruct from './lib/fitness/reconstruct.mjs';
import * as dropParticipant from './lib/fitness/dropParticipant.mjs';
import * as repairSessionWindow from './lib/fitness/repairSessionWindow.mjs';

import * as enrichPlex from './lib/fitness/enrichPlex.mjs';
import * as backfillMediaMemory from './lib/fitness/backfillMediaMemory.mjs';
import * as backfillPrimaryMedia from './lib/fitness/backfillPrimaryMedia.mjs';
import * as repairMediaDuration from './lib/fitness/repairMediaDuration.mjs';
import * as backfillMediaRings from './lib/fitness/backfillMediaRings.mjs';
import * as pairOrphanMedia from './lib/fitness/pairOrphanMedia.mjs';

import * as stravaCrud from './lib/fitness/stravaCrud.mjs';
import * as matchHome from './lib/fitness/matchHome.mjs';
import * as backfillCalories from './lib/fitness/backfillCalories.mjs';
import * as backfillEnrichment from './lib/fitness/backfillEnrichment.mjs';
import * as push from './lib/fitness/push.mjs';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Turn a `{spec, run}` module namespace into a plain command entry. */
const cmd = (mod) => ({ spec: mod.spec, run: mod.run });

const GROUPS = {
  session: {
    summary: 'surgery on stored session YAML (local files only)',
    commands: {
      scan: cmd(scan),
      heal: cmd(heal),
      merge: cmd(merge),
      split: cmd(split),
      reconstruct: cmd(reconstruct),
      'drop-participant': cmd(dropParticipant),
      'repair-window': cmd(repairSessionWindow),
    },
    aliases: new Set(),
  },
  media: {
    summary: 'link sessions to the media that was playing',
    commands: {
      'enrich-plex': cmd(enrichPlex),
      'backfill-memory': cmd(backfillMediaMemory),
      'backfill-primary': cmd(backfillPrimaryMedia),
      'repair-duration': cmd(repairMediaDuration),
      'backfill-rings': cmd(backfillMediaRings),
      'pair-orphans': cmd(pairOrphanMedia),
    },
    aliases: new Set(),
  },
  strava: {
    summary: 'Strava API CRUD, plus session/activity reconciliation',
    commands: {
      ...stravaCrud.commands,
      'match-home': cmd(matchHome),
      'backfill-calories': cmd(backfillCalories),
      'backfill-enrichment': cmd(backfillEnrichment),
      push: cmd(push),
    },
    aliases: stravaCrud.aliases,
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `<group> <command>` — or a bare `<command>` when the name is unique
 * across all groups, so muscle-memory invocations like `fitness heal ...`
 * work without remembering which group a command lives in.
 *
 * @param {string[]} argv
 * @returns {{group: string, name: string, entry: Object, rest: string[]}}
 */
function resolve(argv) {
  const [first, second, ...tail] = argv;

  if (GROUPS[first]) {
    const group = GROUPS[first];
    if (!second) throw new CliError(groupHelp(first), 0);
    const entry = group.commands[second];
    if (!entry) {
      throw new CliError(`unknown ${first} command "${second}"\n\n${groupHelp(first)}`);
    }
    return { group: first, name: second, entry, rest: tail };
  }

  // Bare command name — accept only if exactly one group defines it.
  const matches = Object.entries(GROUPS)
    .filter(([, g]) => g.commands[first])
    .map(([groupName, g]) => ({ groupName, entry: g.commands[first] }));

  if (matches.length === 1) {
    const { groupName, entry } = matches[0];
    return { group: groupName, name: first, entry, rest: [second, ...tail].filter(a => a !== undefined) };
  }
  if (matches.length > 1) {
    const where = matches.map(m => `${m.groupName} ${first}`).join(', ');
    throw new CliError(`"${first}" is ambiguous — say which group: ${where}`);
  }

  throw new CliError(`unknown command "${first}"\n\n${rootHelp()}`);
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function rootHelp() {
  const lines = [
    'Fitness CLI — DaylightStation',
    '',
    'USAGE',
    '  node cli/fitness.cli.mjs <group> <command> [args]',
    '  node cli/fitness.cli.mjs <command> [args]          (when the name is unique)',
    '',
    'GROUPS',
  ];

  for (const [groupName, group] of Object.entries(GROUPS)) {
    lines.push(`  ${groupName.padEnd(9)} ${group.summary}`);
    const names = Object.keys(group.commands).filter(n => !group.aliases.has(n));
    lines.push(`  ${' '.repeat(9)} ${names.join(', ')}`);
    lines.push('');
  }

  lines.push(
    'HELP',
    '  node cli/fitness.cli.mjs <group>                    List a group\'s commands',
    '  node cli/fitness.cli.mjs <group> <command> --help   Full usage for one command',
    '',
    'ENVIRONMENT',
    '  DAYLIGHT_BASE_PATH   Override the data root (default: container path, else repo)',
    '  DAYLIGHT_USER        Default Strava user (default: "user_1")',
    '  DEBUG                Print stack traces on error',
  );

  return lines.join('\n');
}

function groupHelp(groupName) {
  const group = GROUPS[groupName];
  const names = Object.keys(group.commands).filter(n => !group.aliases.has(n));
  const width = Math.max(...names.map(n => n.length));

  const lines = [
    `fitness ${groupName} — ${group.summary}`,
    '',
    'COMMANDS',
  ];
  for (const name of names) {
    lines.push(`  ${name.padEnd(width)}  ${group.commands[name].spec.summary}`);
  }
  lines.push('', `Run "node cli/fitness.cli.mjs ${groupName} <command> --help" for full usage.`);
  return lines.join('\n');
}

function commandHelp(entry) {
  const { spec } = entry;
  const lines = [`${spec.name} — ${spec.summary}`, '', 'USAGE', `  ${spec.usage}`];
  if (spec.details) lines.push('', 'OPTIONS', spec.details);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.length === 0 || ['help', '--help', '-h'].includes(argv[0])) {
  console.log(rootHelp());
  process.exit(0);
}

try {
  const { entry, rest } = resolve(argv);

  if (rest.some(a => a === '--help' || a === '-h')) {
    console.log(commandHelp(entry));
    process.exit(0);
  }

  await entry.run(rest, getContext());
  process.exit(0);
} catch (err) {
  if (err instanceof CliError) {
    // exitCode 0 is how a help-style CliError asks to print without failing.
    const stream = err.exitCode === 0 ? console.log : console.error;
    stream(err.exitCode === 0 ? err.message : `ERROR: ${err.message}`);
    process.exit(err.exitCode ?? 1);
  }
  console.error('ERROR:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
}
