#!/usr/bin/env node
/**
 * Build and validate the exercise-library index manifest.
 *
 * WHY A CLI AT ALL
 * ----------------
 * The reference corpus (~1,287 exercises plus muscle/group/equipment taxonomies,
 * ~4,000 images and 66 videos) lives on a cloud-synced tree whose files are
 * online-only placeholders. Nothing may walk it at request time. This command is
 * the ONLY thing that ever does: it runs offline, once, and emits a single
 * manifest that the backend adapter later reads whole.
 *
 * The manifest is therefore a contract, not a cache. `build` writes it
 * atomically (readers see the old whole document or the new whole document,
 * never a half-written one) and `validate` runs the same builder in memory so a
 * defective corpus can be caught without touching the published file.
 *
 * All index logic lives in `exerciseLibraryIndex.lib.mjs`; this file is a thin
 * composition root — paths from ConfigService, reporting, exit codes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from './_argv.mjs';
import { EXIT_OK, EXIT_FAIL, EXIT_USAGE, printJson, printError } from './_output.mjs';
import { getConfigService } from './_bootstrap.mjs';
import { buildExerciseIndex } from './exerciseLibraryIndex.lib.mjs';
import { saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const ENTRYPOINT = fileURLToPath(import.meta.url);

/** Corpus root, relative to the media directory. */
const CORPUS_SUBPATH = ['library', 'exercise'];
/** Published manifest, relative to the data directory. */
const MANIFEST_SUBPATH = ['household', 'apps', 'fitness', 'exercise-index.yml'];

const VALUE_FLAGS = new Set(['corpus-dir', 'out']);
const BOOLEAN_FLAGS = new Set(['json']);
const ALLOWED_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
const COMMANDS = new Set(['build', 'validate']);

/**
 * Warning kinds whose `subject` is a FIELD NAME rather than a record-unique
 * identifier, so the builder emits one entry PER RECORD instead of aggregating.
 *
 * !! MIRRORS `PER_RECORD_KINDS` in exerciseLibraryIndex.lib.mjs !!
 * The lib does not export it (it is internal to its warning sink), and this
 * command is not the place to widen that module's public surface. The two lists
 * must stay in step: a kind added there and missed here would be reported as
 * "N distinct subjects" when it is really "N separate records", which is exactly
 * the confusion this constant exists to prevent.
 */
const PER_RECORD_KINDS = new Set(['non-scalar-field', 'empty-field']);

const HELP = `exercise-library — build and validate the exercise-reference index manifest

Usage:
  exercise-library.cli.mjs build    [options]
  exercise-library.cli.mjs validate [options]

Commands:
  build      read the corpus, write the manifest, report counts and warnings
  validate   build in memory, report warnings, exit 1 if any exercise resolves
             to zero muscle groups

Options:
  --corpus-dir <path>  corpus root (default: <mediaDir>/${CORPUS_SUBPATH.join('/')})
  --out <path>         manifest path, build only
                       (default: <dataDir>/${MANIFEST_SUBPATH.join('/')})
  --json               emit the report as a single JSON object
  --help, -h           show this message

The corpus is a cloud-synced tree of online-only placeholders; a cold build can
take many minutes. Nothing else in the system may read it — every runtime reader
loads the manifest this command writes.

Exit codes: 0 ok, 1 validation failure or build error, 2 usage error.
`;

// --------------------------------------------------------------------------
// paths
// --------------------------------------------------------------------------

function pathFlag(value, name) {
  if (value === undefined) return null;
  if (value === true || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--${name} needs a path`);
  }
  return path.resolve(value.trim());
}

/**
 * Resolve the corpus root and manifest path.
 *
 * ConfigService is consulted ONLY for the parts no flag supplied — a fully
 * flagged invocation (the test path, and any one-off run against a staging
 * copy) never initializes it, so it needs neither DAYLIGHT_BASE_PATH nor a
 * mounted data volume.
 *
 * @param {{flags?: object, needManifest?: boolean}} args
 * @returns {Promise<{corpusDir: string, manifestPath: string|null}>}
 */
export async function resolveExercisePaths({ flags = {}, needManifest = true } = {}) {
  const corpusFlag = pathFlag(flags['corpus-dir'], 'corpus-dir');
  const outFlag = pathFlag(flags.out, 'out');
  const needsConfig = !corpusFlag || (needManifest && !outFlag);
  const config = needsConfig ? await getConfigService() : null;
  return {
    corpusDir: corpusFlag ?? path.join(config.getMediaDir(), ...CORPUS_SUBPATH),
    manifestPath: needManifest
      ? (outFlag ?? path.join(config.getDataDir(), ...MANIFEST_SUBPATH))
      : outFlag,
  };
}

// --------------------------------------------------------------------------
// warning reporting
// --------------------------------------------------------------------------

/**
 * Group a warning list by kind, counting each kind the way that kind is
 * actually shaped.
 *
 * Aggregated kinds carry their own multiplicity: ONE entry whose `count` is the
 * number of distinct records that hit it (the live corpus's missing `core`
 * group is one entry with a count in the hundreds). Per-record kinds carry
 * theirs in the entry list: N entries, each count 1, sharing a `subject` that
 * names a FIELD rather than the defect. Summing `count` across a per-record kind
 * and calling the result "distinct defects" would be a lie in both directions,
 * so the two are counted separately and labelled differently downstream.
 *
 * @returns {Array<{kind: string, perRecord: boolean, entries: number,
 *   records: number, warnings: Array<object>}>} sorted by kind.
 */
export function summarizeWarnings(warnings = []) {
  const byKind = new Map();
  for (const warning of warnings) {
    if (!byKind.has(warning.kind)) byKind.set(warning.kind, []);
    byKind.get(warning.kind).push(warning);
  }
  return [...byKind.entries()]
    .map(([kind, entries]) => {
      const perRecord = PER_RECORD_KINDS.has(kind);
      return {
        kind,
        perRecord,
        entries: entries.length,
        records: perRecord
          // One entry per record, so the record total is the distinct set of
          // records — never the entry count, which would double-count a record
          // whose `instructions` AND `equipment` are both empty.
          ? new Set(entries.map((entry) => entry.referencedBy)).size
          : entries.reduce((total, entry) => total + (entry.count ?? 1), 0),
        warnings: entries,
      };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function formatAggregatedKind(summary, lines) {
  // "defect" rather than "subject": entries are deduplicated by
  // (kind, subject, referrer), so the SAME subject can legitimately appear twice
  // under two referrers — `core` missing, blamed once on the muscle that
  // declares it and once on the exercise that hints at it.
  lines.push(
    `  ${summary.kind} — aggregated: `
    + `${summary.entries} defect(s), ${summary.records} referencing record(s)`,
  );
  [...summary.warnings]
    .sort((a, b) => (b.count - a.count) || String(a.subject).localeCompare(String(b.subject)))
    .forEach((warning) => {
      const parts = [`    ${warning.subject}`, `×${warning.count}`];
      if (warning.referrer) parts.push(`referrer=${warning.referrer}`);
      // `referencedBy` is only the FIRST record to raise an aggregated defect;
      // labelling it "first" keeps a reader from reading it as the only one.
      if (warning.referencedBy) parts.push(`first=${warning.referencedBy}`);
      lines.push(parts.join('  '));
    });
}

function formatPerRecordKind(summary, lines) {
  const byField = new Map();
  for (const warning of summary.warnings) {
    if (!byField.has(warning.subject)) byField.set(warning.subject, []);
    byField.get(warning.subject).push(warning);
  }
  lines.push(
    `  ${summary.kind} — one entry per record: `
    + `${summary.records} record(s) across ${byField.size} field(s)`,
  );
  [...byField.keys()].sort().forEach((field) => {
    const entries = byField.get(field);
    const referrer = entries[0].referrer ? ` (referrer=${entries[0].referrer})` : '';
    lines.push(`    ${field}${referrer} — ${entries.length} record(s)`);
    entries
      .map((entry) => entry.referencedBy ?? '(unattributed)')
      .sort()
      .forEach((record) => lines.push(`      ${record}`));
  });
}

/**
 * Render the FULL warning list — every entry, never a truncated sample. The
 * whole point of the report is that a human reads it once per corpus refresh and
 * decides what is a real defect; a "+N more" tail would hide exactly the long
 * tail that matters.
 */
export function formatWarningReport(warnings = []) {
  const summaries = summarizeWarnings(warnings);
  if (summaries.length === 0) return 'Warnings: no warnings\n';

  const lines = [`Warnings — ${summaries.length} kind(s), ${warnings.length} entry/entries`, ''];
  summaries.forEach((summary, index) => {
    if (index > 0) lines.push('');
    if (summary.perRecord) formatPerRecordKind(summary, lines);
    else formatAggregatedKind(summary, lines);
  });
  return `${lines.join('\n')}\n`;
}

// --------------------------------------------------------------------------
// commands
// --------------------------------------------------------------------------

function countIndex(index) {
  const exercises = Object.values(index.exercises);
  return {
    exercises: exercises.length,
    muscles: Object.keys(index.muscles).length,
    muscleGroups: Object.keys(index.muscleGroups).length,
    equipment: Object.keys(index.equipment).length,
    videos: exercises.filter((exercise) => exercise.video).length,
    stills: exercises.reduce((total, exercise) => total + exercise.stills.length, 0),
    warnings: index.warnings.length,
  };
}

/** Exercises that reached no muscle group — the one condition `validate` fails on. */
function ungroupedExercises(index) {
  return Object.values(index.exercises)
    .filter((exercise) => exercise.groups.length === 0)
    .map((exercise) => ({ slug: exercise.slug, targetMuscles: exercise.targetMuscles }));
}

function baseReport({ command, corpusDir, index }) {
  return {
    command,
    corpusDir,
    manifestPath: null,
    builtAt: index.builtAt,
    assetsResolved: index.assetsResolved,
    version: index.version,
    counts: countIndex(index),
    ungrouped: ungroupedExercises(index),
    warnings: index.warnings,
    warningSummary: summarizeWarnings(index.warnings).map(({ warnings, ...rest }) => rest),
    ok: true,
    error: null,
  };
}

/**
 * Build the index and publish the manifest.
 *
 * Warnings never fail a build: the corpus is third-party data and a defective
 * record is information, not a reason to leave the runtime without an index.
 * Only an unwritable manifest fails.
 */
export function runBuild({ corpusDir, manifestPath, now = () => new Date().toISOString() }) {
  const index = buildExerciseIndex(corpusDir, { builtAt: now() });
  const report = { ...baseReport({ command: 'build', corpusDir, index }), manifestPath };
  try {
    // `noRefs` keeps YAML anchors/aliases out of the manifest — the adapter that
    // reads it should not have to care whether two records shared a JS reference.
    saveYamlToPathAtomic(manifestPath, index, { noRefs: true });
  } catch (error) {
    return { ...report, ok: false, error: error.message };
  }
  return report;
}

/** Build in memory and judge the result. Writes nothing. */
export function runValidate({ corpusDir }) {
  const index = buildExerciseIndex(corpusDir, { builtAt: null });
  const report = baseReport({ command: 'validate', corpusDir, index });
  return { ...report, ok: report.ungrouped.length === 0 };
}

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

function countLine(label, value) {
  return `  ${label.padEnd(12)}${value}`;
}

export function formatReport(report) {
  const lines = [`Exercise library — ${report.command}`, '', `  corpus      ${report.corpusDir}`];
  if (report.manifestPath) lines.push(`  manifest    ${report.manifestPath}`);
  if (report.builtAt) lines.push(`  built at    ${report.builtAt}`);
  if (!report.assetsResolved) {
    lines.push('  assets      UNRESOLVED — no assets/ directory, image paths are guesses');
  }

  lines.push('', 'Counts');
  lines.push(countLine('exercises', report.counts.exercises));
  lines.push(countLine('muscles', report.counts.muscles));
  lines.push(countLine('groups', report.counts.muscleGroups));
  lines.push(countLine('equipment', report.counts.equipment));
  lines.push(countLine('videos', report.counts.videos));
  lines.push(countLine('stills', report.counts.stills));

  lines.push('', formatWarningReport(report.warnings).trimEnd());

  if (report.ungrouped.length) {
    lines.push('', `Exercises resolving to zero muscle groups — ${report.ungrouped.length}`);
    report.ungrouped.forEach(({ slug, targetMuscles }) => {
      const targets = targetMuscles.length ? targetMuscles.join(', ') : 'no target muscles';
      lines.push(`  ${slug}  (${targets})`);
    });
  }

  lines.push('');
  if (report.error) {
    lines.push(`FAILED — ${report.error}`);
  } else if (report.command === 'build') {
    lines.push(`OK — manifest written to ${report.manifestPath}`);
  } else if (report.ok) {
    lines.push('OK — every exercise resolves to at least one muscle group');
  } else {
    lines.push(`FAILED — ${report.ungrouped.length} exercise(s) resolve to no muscle group`);
  }
  return `${lines.join('\n')}\n`;
}

// --------------------------------------------------------------------------
// entrypoint
// --------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2), io = process, deps = {}) {
  const { subcommand, flags, help } = parseArgv(argv);
  if (help || !subcommand) {
    io.stdout.write(HELP);
    return help ? EXIT_OK : EXIT_USAGE;
  }
  if (!COMMANDS.has(subcommand)) {
    io.stderr.write(`Unknown command: ${subcommand}\n\n`);
    io.stdout.write(HELP);
    return EXIT_USAGE;
  }
  const unknown = Object.keys(flags).filter((flag) => !ALLOWED_FLAGS.has(flag));
  if (unknown.length) {
    io.stderr.write(`Unknown option: --${unknown[0]}\n`);
    return EXIT_USAGE;
  }
  if (flags.json !== undefined && flags.json !== true) {
    io.stderr.write('ERROR: --json does not take a value\n');
    return EXIT_USAGE;
  }
  if (subcommand === 'validate' && flags.out !== undefined) {
    io.stderr.write('ERROR: --out is only valid for `build`\n');
    return EXIT_USAGE;
  }

  let paths;
  try {
    paths = await resolveExercisePaths({ flags, needManifest: subcommand === 'build' });
  } catch (error) {
    io.stderr.write(`ERROR: ${error.message}\n`);
    return EXIT_USAGE;
  }

  const report = subcommand === 'build'
    ? runBuild({ corpusDir: paths.corpusDir, manifestPath: paths.manifestPath, now: deps.now })
    : runValidate({ corpusDir: paths.corpusDir });

  if (flags.json === true) printJson(io.stdout, report);
  else io.stdout.write(formatReport(report));

  return report.ok ? EXIT_OK : EXIT_FAIL;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      printError(process.stderr, error);
      process.exitCode = EXIT_FAIL;
    });
}
