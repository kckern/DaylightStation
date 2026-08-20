#!/usr/bin/env node
/**
 * Validate a published, device-neutral SchoolCalc content mount.
 *
 * The CLI is a small composition root: mounted YAML adapters live here while
 * all catalog, module, and cross-reference rules remain in School application
 * and domain code.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv } from '../_argv.mjs';
import {
  ValidateSchoolCalcPublication,
} from '#apps/school/schoolcalc/index.mjs';
import {
  BuildLearningLesson,
  createCoreLearningModuleRegistry,
} from '#apps/school/catalog/index.mjs';
import {
  YamlLearningCatalogRepository,
  YamlLearningContentRepository,
} from '#adapters/school/catalog/index.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);
const ALLOWED_FLAGS = new Set([
  'data-dir',
  'content-root',
  'catalog-directories',
  'document-directories',
  'question-bank-directories',
  'json',
]);

const HELP = `schoolcalc-catalog — validate a published School Catalog for SchoolCalc

Usage:
  school.mjs calc validate [options]

Options:
  --data-dir <path>                  data root (default: $DAYLIGHT_BASE_PATH/data)
  --content-root <path>              content root, absolute or data-relative
                                     (default: content/school/learning-catalog)
  --catalog-directories <a,b>        override Catalog mount directories
  --document-directories <a,b>       override learning-document mount directories
  --question-bank-directories <a,b>  override question-bank mount directories
  --json                             emit the stable JSON report
  --help, -h                         show this message

Directory lists are comma-separated; relative entries resolve under --data-dir.
Exit 1 on any malformed Catalog, unknown module, or dangling content reference.
`;

export async function runSchoolCalcPublicationValidation({
  catalogDirectories,
  documentDirectories,
  bankDirectories,
} = {}) {
  const catalogs = new YamlLearningCatalogRepository({ directories: catalogDirectories });
  const content = new YamlLearningContentRepository({
    documentDirectories,
    bankDirectories,
  });
  const bundles = new BuildLearningLesson({
    catalogs,
    content,
    modules: createCoreLearningModuleRegistry(),
  });
  return new ValidateSchoolCalcPublication({ catalogs, bundles }).execute();
}

export function resolveSchoolCalcContentPaths({ flags = {}, env = process.env } = {}) {
  const dataDir = resolveRequiredPath(
    flags['data-dir'],
    env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : '/usr/src/app/data',
    '--data-dir',
  );
  const contentRoot = resolveFrom(
    dataDir,
    valueFlag(flags['content-root'], 'content/school/learning-catalog', '--content-root'),
  );
  return {
    dataDir,
    contentRoot,
    catalogDirectories: directoryList(
      flags['catalog-directories'],
      [path.join(contentRoot, 'catalogs')],
      dataDir,
      '--catalog-directories',
    ),
    documentDirectories: directoryList(
      flags['document-directories'],
      [path.join(contentRoot, 'documents')],
      dataDir,
      '--document-directories',
    ),
    bankDirectories: directoryList(
      flags['question-bank-directories'],
      [path.join(contentRoot, 'question-banks')],
      dataDir,
      '--question-bank-directories',
    ),
  };
}

export function formatSchoolCalcPublicationReport(report, paths) {
  const lines = [
    `School Catalog: ${paths.contentRoot}`,
    `  catalogs  ${report.summary.catalogs} (${report.summary.validCatalogs} valid)`,
    `  sets      ${report.summary.installSets ?? 0} install`,
    `  lessons   ${report.summary.lessons} (${report.summary.validLessons} valid)`,
    `  modules   ${report.summary.modules} (${report.summary.resolvedModules} resolved)`,
  ];
  if (report.capabilities.length) lines.push(`  capabilities  ${report.capabilities.join(', ')}`);
  appendErrors(lines, 'Catalog errors', report.catalogErrors);
  appendErrors(lines, 'Lesson errors', report.lessonErrors);
  lines.push('', report.ok
    ? 'OK — School Catalog is promotable'
    : 'FAILED — School Catalog is not promotable');
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), io = process) {
  const { subcommand, flags, help } = parseArgv(argv);
  if (help || !subcommand) {
    io.stdout.write(HELP);
    return help ? EXIT_OK : EXIT_USAGE;
  }
  if (subcommand !== 'validate') {
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

  let paths;
  try {
    paths = resolveSchoolCalcContentPaths({ flags });
  } catch (error) {
    io.stderr.write(`ERROR: ${error.message}\n`);
    return EXIT_USAGE;
  }

  const report = await runSchoolCalcPublicationValidation(paths);
  io.stdout.write(flags.json === true
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatSchoolCalcPublicationReport(report, paths));
  return report.ok ? EXIT_OK : EXIT_FAIL;
}

function appendErrors(lines, heading, byId) {
  const ids = Object.keys(byId).sort();
  if (!ids.length) return;
  lines.push('', heading);
  ids.forEach((id) => {
    lines.push(`  ${id}`);
    byId[id].forEach((error) => lines.push(`    - ${error}`));
  });
}

function valueFlag(value, fallback, name) {
  if (value === undefined) return fallback;
  if (value === true || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} needs a path`);
  }
  return value;
}

function resolveRequiredPath(value, fallback, name) {
  return path.resolve(valueFlag(value, fallback, name));
}

function resolveFrom(dataDir, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(dataDir, value);
}

function directoryList(value, fallback, dataDir, name) {
  if (value === undefined) return fallback;
  if (value === true || typeof value !== 'string') throw new Error(`${name} needs a comma-separated path list`);
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => entry.length === 0)) {
    throw new Error(`${name} must contain non-empty comma-separated paths`);
  }
  return [...new Set(entries.map((entry) => resolveFrom(dataDir, entry)))];
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = EXIT_FAIL;
    });
}
