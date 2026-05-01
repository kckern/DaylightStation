#!/usr/bin/env node

/**
 * ingest-health-archive CLI
 *
 * Invokes the HealthArchiveIngestion service for every enabled category in a
 * user's `health-archive.yml` config, writes per-category `manifest.yml`, and
 * prints a summary. See plan: F-101 of the personalized-pattern-aware-coaching
 * design (docs/roadmap/2026-05-01-personalized-pattern-aware-coaching-design.md).
 *
 * Run:
 *   npm run ingest:health-archive -- --user <userId> [--dry-run] [--category <c>]
 *
 * Flags:
 *   --user <userId>          (required) the owning user id
 *   --config <path>          override default config path
 *   --source <path>          override the config-derived source path for a single
 *                            category (must combine with --category in practice)
 *   --category <category>    restrict to one of the whitelist categories
 *   --dry-run                plan only — no writes
 *   --data-root <path>       override structured-archive root (default:
 *                              data/users/{userId}/lifelog/archives/)
 *   --media-root <path>      override raw-archive root (default: media/archives/)
 *   --help, -h               show this message
 *
 * Exit codes:
 *   0  success
 *   1  any category failed, or fatal config/arg error
 *
 * @module cli/ingest-health-archive
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import yaml from 'js-yaml';

import { HealthArchiveIngestion } from '#domains/health/services/HealthArchiveIngestion.mjs';
import {
  HealthArchiveManifest,
  VALID_CATEGORIES,
} from '#domains/health/entities/HealthArchiveManifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Argument parsing — small inline parser, no extra dependency
// ============================================================================

/**
 * Parse argv into a flat options object.
 * Supports `--key value` and `--flag` forms.
 */
function parseArgs(argv) {
  const opts = {
    user: null,
    config: null,
    source: null,
    category: null,
    dryRun: false,
    dataRoot: null,
    mediaRoot: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--user':
        opts.user = args[++i];
        break;
      case '--config':
        opts.config = args[++i];
        break;
      case '--source':
        opts.source = args[++i];
        break;
      case '--category':
        opts.category = args[++i];
        break;
      case '--data-root':
        opts.dataRoot = args[++i];
        break;
      case '--media-root':
        opts.mediaRoot = args[++i];
        break;
      default:
        // Unknown arg — surface, don't silently swallow.
        process.stderr.write(`Unknown argument: ${a}\n`);
        opts.help = true;
        opts._error = `unknown:${a}`;
        break;
    }
  }
  return opts;
}

function printHelp(stream = process.stdout) {
  const msg = [
    'ingest-health-archive — copy a user\'s external health archive into the',
    'per-user structured store and write per-category manifest.yml files.',
    '',
    'Usage:',
    '  node cli/ingest-health-archive.cli.mjs --user <userId> [options]',
    '',
    'Required:',
    '  --user <userId>          owning user identifier (e.g. test-user)',
    '',
    'Options:',
    '  --config <path>          config file (default: data/users/{userId}/config/health-archive.yml)',
    '  --source <path>          override source path (with --category)',
    '  --category <name>        restrict to one category',
    `                           (one of: ${[...VALID_CATEGORIES].join(', ')})`,
    '  --dry-run                plan only; do not write any files',
    '  --data-root <path>       override structured-archive root',
    '                           (default: data/users/{userId}/lifelog/archives/)',
    '  --media-root <path>      override raw-archive root (default: media/archives/)',
    '  --help, -h               show this help',
    '',
    'Exit codes:',
    '  0  all categories succeeded',
    '  1  one or more categories failed, or fatal config/arg error',
    '',
  ].join('\n');
  stream.write(msg + '\n');
}

// ============================================================================
// Config loading
// ============================================================================

function defaultConfigPath(userId) {
  return path.join(REPO_ROOT, 'data', 'users', userId, 'config', 'health-archive.yml');
}

async function loadConfig(configPath) {
  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`config not found: ${configPath}`);
    }
    throw new Error(`failed to read config ${configPath}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`failed to parse YAML config ${configPath}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`config is empty or not an object: ${configPath}`);
  }
  return parsed;
}

// ============================================================================
// Destination path resolution
// ============================================================================

/**
 * Map a category to its destination directory.
 * - `scans` and any future raw-blob categories live under media-root
 * - everything else (notes, weight, workouts, nutrition-history, playbook)
 *   lives under data-root.
 */
function resolveDestPath({ category, userId, dataRoot, mediaRoot }) {
  if (category === 'scans') {
    return path.join(mediaRoot, 'scans', userId);
  }
  // All other valid categories are structured archives.
  return path.join(dataRoot, category);
}

function defaultDataRoot(userId) {
  return path.join(REPO_ROOT, 'data', 'users', userId, 'lifelog', 'archives');
}

function defaultMediaRoot() {
  return path.join(REPO_ROOT, 'media', 'archives');
}

// ============================================================================
// Manifest writing
// ============================================================================

async function writeManifest({ destPath, userId, category, sourcePath, report, dryRun }) {
  if (dryRun) return null;
  const manifest = new HealthArchiveManifest({
    userId,
    category,
    lastSync: new Date().toISOString(),
    sourceLocations: [{ path: sourcePath }],
    schemaVersions: {},
    recordCounts: {
      copied: report.copied.length,
      skipped: report.skipped.length,
      failed: report.failed.length,
    },
  });
  await fs.mkdir(destPath, { recursive: true });
  const manifestPath = path.join(destPath, 'manifest.yml');
  await fs.writeFile(manifestPath, yaml.dump(manifest.serialize()));
  return manifestPath;
}

// ============================================================================
// Per-category execution
// ============================================================================

async function ingestCategory({
  ingestion,
  userId,
  category,
  sourcePath,
  destPath,
  dryRun,
}) {
  const report = await ingestion.ingest({
    userId,
    category,
    sourcePath,
    destPath,
    dryRun,
  });
  const manifestPath = await writeManifest({
    destPath,
    userId,
    category,
    sourcePath,
    report,
    dryRun,
  });
  return { report, manifestPath };
}

// ============================================================================
// Summary printing
// ============================================================================

function printSummary(results, { dryRun }) {
  const header = dryRun
    ? '\n[DRY-RUN] ingest-health-archive summary:'
    : '\ningest-health-archive summary:';
  process.stdout.write(header + '\n');
  process.stdout.write('='.repeat(60) + '\n');

  for (const r of results) {
    const status = r.error ? '[FAIL]' : '[OK]  ';
    const counts = r.error
      ? `error: ${r.error}`
      : `copied=${r.report.copied.length} skipped=${r.report.skipped.length} failed=${r.report.failed.length}`;
    process.stdout.write(`${status} ${r.category.padEnd(20)} ${counts}\n`);
  }

  const totalOk = results.filter((r) => !r.error).length;
  const totalFail = results.filter((r) => r.error).length;
  process.stdout.write('='.repeat(60) + '\n');
  process.stdout.write(`Total: ${totalOk} succeeded, ${totalFail} failed\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    if (opts._error) {
      // Unknown arg already printed to stderr; exit non-zero.
      printHelp(process.stderr);
      return 1;
    }
    printHelp(process.stdout);
    return 0;
  }

  if (!opts.user) {
    process.stderr.write('Error: --user <userId> is required\n');
    printHelp(process.stderr);
    return 1;
  }

  if (opts.source && !opts.category) {
    process.stderr.write('Error: --source requires --category (otherwise the same source is applied to every enabled category)\n');
    return 1;
  }

  const userId = opts.user;
  const dryRun = opts.dryRun;
  const configPath = opts.config || defaultConfigPath(userId);
  const dataRoot = opts.dataRoot || defaultDataRoot(userId);
  const mediaRoot = opts.mediaRoot || defaultMediaRoot();

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }

  const sources = config.sources || {};
  const categoryNames = Object.keys(sources);
  if (categoryNames.length === 0) {
    process.stderr.write(`Error: no sources defined in ${configPath}\n`);
    return 1;
  }

  // Filter to requested category if --category given
  let toRun = categoryNames;
  if (opts.category) {
    if (!VALID_CATEGORIES.has(opts.category)) {
      process.stderr.write(
        `Error: invalid --category "${opts.category}" ` +
          `(must be one of: ${[...VALID_CATEGORIES].join(', ')})\n`,
      );
      return 1;
    }
    toRun = categoryNames.filter((c) => c === opts.category);
    if (toRun.length === 0) {
      process.stderr.write(
        `Error: --category "${opts.category}" not found in config sources\n`,
      );
      return 1;
    }
  }

  const ingestion = new HealthArchiveIngestion({ fs, logger: console });
  const results = [];

  for (const category of toRun) {
    const sourceCfg = sources[category] || {};
    if (sourceCfg.enabled === false) {
      // Honor "enabled: false" — skip silently in summary
      continue;
    }
    if (!VALID_CATEGORIES.has(category)) {
      results.push({
        category,
        error: `invalid category "${category}" (must be one of: ${[...VALID_CATEGORIES].join(', ')})`,
      });
      continue;
    }

    // --source override only makes sense paired with --category; if the user
    // gave --source without --category, we still apply it to whichever single
    // category we're running. If multiple categories are running with
    // --source, that's almost certainly a mistake — apply to all and let the
    // user notice in the summary.
    const sourcePath = opts.source || sourceCfg.path;
    if (!sourcePath) {
      results.push({
        category,
        error: `no source path configured for category "${category}"`,
      });
      continue;
    }

    const destPath = resolveDestPath({ category, userId, dataRoot, mediaRoot });

    try {
      const { report, manifestPath } = await ingestCategory({
        ingestion,
        userId,
        category,
        sourcePath,
        destPath,
        dryRun,
      });
      results.push({ category, report, manifestPath });
    } catch (err) {
      results.push({ category, error: err.message });
    }
  }

  printSummary(results, { dryRun });

  // Surface per-category failures to stderr so callers parsing logs see them.
  for (const r of results) {
    if (r.error) {
      process.stderr.write(`Error [${r.category}]: ${r.error}\n`);
    }
  }

  const anyFail = results.some((r) => r.error);
  return anyFail ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`Fatal: ${err.stack || err.message}\n`);
    process.exit(1);
  });
