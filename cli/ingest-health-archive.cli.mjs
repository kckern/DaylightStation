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
  BUILT_IN_CATEGORIES,
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
    playbook: null,
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
      case '--playbook':
        opts.playbook = args[++i];
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
    `                           (built-in: ${BUILT_IN_CATEGORIES.join(', ')};`,
    '                           any extra category declared in playbook',
    '                           archive.custom_categories is also accepted)',
    '  --dry-run                plan only; do not write any files',
    '  --data-root <path>       override structured-archive root',
    '                           (default: data/users/{userId}/lifelog/archives/)',
    '  --media-root <path>      override raw-archive root (default: media/archives/)',
    '  --playbook <path>        override playbook path used to resolve',
    '                           archive.custom_categories (default:',
    '                           data/users/{userId}/lifelog/archives/playbook/playbook.yml)',
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
 *
 * Built-in categories use the historical mapping:
 * - `scans` (a raw-blob category) lives under media-root with userId scoping
 * - everything else (notes, weight, workouts, nutrition-history, playbook)
 *   lives under data-root
 *
 * Custom categories (declared in playbook archive.custom_categories) are
 * routed by their declared `destination`:
 * - `'structured'` → data-root/<category>/
 * - `'media'` → media-root/<category>/<userId>/ (matches scans)
 *
 * @param {object} args
 * @param {string} args.category
 * @param {string} args.userId
 * @param {string} args.dataRoot
 * @param {string} args.mediaRoot
 * @param {Map<string, {destination: string}>} [args.customCategoryConfig]
 *   key → declaration map for playbook-declared extras
 */
function resolveDestPath({ category, userId, dataRoot, mediaRoot, customCategoryConfig }) {
  // Custom-category routing takes precedence — a playbook author who
  // re-declares a built-in name with a different destination is asserting
  // intent. Built-ins still have their default routing for callers without
  // a customCategoryConfig entry.
  const custom = customCategoryConfig && customCategoryConfig.get(category);
  if (custom) {
    return resolveCustomDestination({
      category,
      destination: custom.destination,
      userId,
      dataRoot,
      mediaRoot,
    });
  }
  if (category === 'scans') {
    return path.join(mediaRoot, 'scans', userId);
  }
  // All other built-in categories are structured archives.
  return path.join(dataRoot, category);
}

/**
 * Compute the destination directory for a playbook-declared custom category.
 *
 * - `destination: 'structured'` → `<dataRoot>/<category>/` (matches built-in
 *   structured archives like notes/, weight/, ...)
 * - `destination: 'media'` → `<mediaRoot>/<category>/<userId>/` (matches the
 *   built-in `scans/` shape)
 *
 * Throws on unknown destination tokens so misspellings surface as a config
 * error rather than silently routing to data-root.
 */
function resolveCustomDestination({ category, destination, userId, dataRoot, mediaRoot }) {
  if (destination === 'structured') return path.join(dataRoot, category);
  if (destination === 'media') return path.join(mediaRoot, category, userId);
  throw new Error(
    `Unknown destination "${destination}" for custom category "${category}" ` +
    '(must be "structured" or "media")',
  );
}

/**
 * Default path to the user's playbook YAML. Optional input — if missing,
 * custom categories are simply unavailable for this run.
 */
function defaultPlaybookPath(userId) {
  return path.join(
    REPO_ROOT, 'data', 'users', userId,
    'lifelog', 'archives', 'playbook', 'playbook.yml',
  );
}

/**
 * Read the user's playbook (if present) and project the
 * `archive.custom_categories` list into a Map keyed by category name.
 *
 * Each entry has shape `{ key, destination }` (extra fields ignored).
 * Validates `destination` is `'structured'` or `'media'` so a typo surfaces
 * here, not later when destination resolution fails.
 *
 * @param {string} playbookPath absolute path to the user's playbook.yml
 * @returns {Promise<Map<string, {destination: string}>>}
 */
async function loadCustomCategoryConfig(playbookPath) {
  const parsed = await loadPlaybookSafely(playbookPath);
  const out = new Map();
  if (!parsed) return out;
  const declared = parsed?.archive?.custom_categories;
  if (!Array.isArray(declared)) return out;
  for (const entry of declared) {
    if (!entry || typeof entry !== 'object') continue;
    const { key, destination } = entry;
    if (typeof key !== 'string' || !key.length) continue;
    if (destination !== 'structured' && destination !== 'media') {
      throw new Error(
        `playbook archive.custom_categories[${key}].destination must be ` +
        `"structured" or "media" (got: ${String(destination)})`,
      );
    }
    out.set(key, { destination });
  }
  return out;
}

/**
 * Read the user's playbook (if present) and project the
 * `archive.additional_privacy_exclusions` list into a string[]. Non-strings
 * and empty/whitespace entries are dropped. Missing playbook → `[]`.
 *
 * The strings are passed through to HealthArchiveIngestion which compiles
 * them into RegExp objects with metacharacter escaping. The code-level floor
 * (email/chat/...) is independent and ALWAYS applies — these only ADD.
 *
 * @param {string} playbookPath absolute path to the user's playbook.yml
 * @returns {Promise<string[]>}
 */
async function loadAdditionalPrivacyExclusions(playbookPath) {
  const parsed = await loadPlaybookSafely(playbookPath);
  if (!parsed) return [];
  const declared = parsed?.archive?.additional_privacy_exclusions;
  if (!Array.isArray(declared)) return [];
  const out = [];
  for (const entry of declared) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * Best-effort playbook reader: returns the parsed object, or `null` if the
 * file is missing or unparseable. Other I/O errors propagate.
 *
 * @param {string} playbookPath
 * @returns {Promise<object|null>}
 */
async function loadPlaybookSafely(playbookPath) {
  let raw;
  try {
    raw = await fs.readFile(playbookPath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return yaml.load(raw);
  } catch {
    return null;
  }
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

async function writeManifest({ destPath, userId, category, sourcePath, report, dryRun, validCategories }) {
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
    validCategories,
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
  customCategories,
  additionalPrivacyExclusions,
  validCategories,
}) {
  const report = await ingestion.ingest({
    userId,
    category,
    sourcePath,
    destPath,
    dryRun,
    customCategories,
    additionalPrivacyExclusions,
  });
  const manifestPath = await writeManifest({
    destPath,
    userId,
    category,
    sourcePath,
    report,
    dryRun,
    validCategories,
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
  const playbookPath = opts.playbook || defaultPlaybookPath(userId);

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }

  // F4-B: load per-user custom categories from playbook (best effort).
  let customCategoryConfig;
  try {
    customCategoryConfig = await loadCustomCategoryConfig(playbookPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
  const customCategoryKeys = [...customCategoryConfig.keys()];

  // F4-C: load per-user additional privacy exclusions from playbook (best
  // effort). These ADD to the code-level floor; users cannot remove floor
  // entries. See backend/src/2_domains/health/policies/PrivacyExclusions.mjs.
  let additionalPrivacyExclusions;
  try {
    additionalPrivacyExclusions = await loadAdditionalPrivacyExclusions(playbookPath);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    return 1;
  }
  const validCategorySet = new Set([
    ...BUILT_IN_CATEGORIES,
    ...customCategoryKeys,
  ]);

  const sources = config.sources || {};
  const categoryNames = Object.keys(sources);
  if (categoryNames.length === 0) {
    process.stderr.write(`Error: no sources defined in ${configPath}\n`);
    return 1;
  }

  // Filter to requested category if --category given
  let toRun = categoryNames;
  if (opts.category) {
    if (!validCategorySet.has(opts.category)) {
      process.stderr.write(
        `Error: invalid --category "${opts.category}" ` +
          `(must be one of: ${[...validCategorySet].join(', ')})\n`,
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
    if (!validCategorySet.has(category)) {
      results.push({
        category,
        error: `invalid category "${category}" (must be one of: ${[...validCategorySet].join(', ')})`,
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

    let destPath;
    try {
      destPath = resolveDestPath({
        category, userId, dataRoot, mediaRoot, customCategoryConfig,
      });
    } catch (err) {
      results.push({ category, error: err.message });
      continue;
    }

    try {
      const { report, manifestPath } = await ingestCategory({
        ingestion,
        userId,
        category,
        sourcePath,
        destPath,
        dryRun,
        customCategories: customCategoryKeys,
        additionalPrivacyExclusions,
        validCategories: validCategorySet,
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
