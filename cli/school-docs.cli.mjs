#!/usr/bin/env node
/**
 * `school:docs` — validate and proof-render print-document source YAML
 * (envelope v1 or v2, spec §4/§7).
 *
 * A small composition root, mirroring `schoolcalc-catalog.cli.mjs`: the YAML
 * parse + `--out` file write live here while every structural/fit rule stays
 * in the School domain (`validateAnyDocument`) and application
 * (`RenderPrintDocument`) layers.
 *
 * `validate <file|dir>` is render-free (parse + `validateAnyDocument` only)
 * so it stays sub-second for an AI repair loop. `render <file>` runs the real
 * v2 fit pipeline (or the v1 legacy passthrough) and writes a PDF; a
 * `FIT_OVERSET` rejection from `RenderPrintDocument` is reported with its
 * `oversetPt` amount, not just the bare message, so the same repair loop
 * knows how many points to trim.
 *
 * Determinism note (`--creation-date`): `DocumentPdfRenderer` pins the PDF's
 * `CreationDate` to a fixed epoch unconditionally — no clock, no option — so
 * two renders of the same document are already byte-identical without any
 * date input. `--creation-date` is accepted (and shape-validated) here for
 * proofing-workflow symmetry with `--learner-name`/`--date`/`--type-scale`;
 * it is intentionally NOT threaded anywhere, since there is nothing in the
 * renderer today for it to override.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseArgv } from './_argv.mjs';
import { validateAnyDocument, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);

const DENSITIES = new Set(['normal', 'compact']);

const COMMON_FLAGS = new Set(['data-dir', 'content-root']);
const VALIDATE_FLAGS = new Set([...COMMON_FLAGS]);
const RENDER_FLAGS = new Set([
  ...COMMON_FLAGS,
  'out',
  'learner-name',
  'date',
  'type-scale',
  'density',
  'creation-date',
]);

const HELP = `school-docs — validate and proof-render School print-document source YAML

Usage:
  school-docs.cli.mjs validate <file|dir> [options]
  school-docs.cli.mjs render <file> --out <pdf> [options]

Commands:
  validate <file|dir>   parse + validateAnyDocument (v1 or v2); directory form
                         walks *.yml (non-recursive). Render-free, sub-second.
  render <file>          run the real fit/render pipeline and write a PDF.

Options:
  --data-dir <path>      data root (default: $DAYLIGHT_BASE_PATH/data)
  --content-root <path>  content root, absolute or data-relative
                         (default: content/school/print-documents)
  --out <path>           (render) output PDF path — required
  --learner-name <s>     (render) prefill the header Name line
  --date <s>             (render) prefill the header Date line
  --type-scale <s>       (render) override document.fit.typeScale for proofing
  --density <normal|compact>  (render) accepted for proofing symmetry
  --creation-date <iso>  (render) accepted for proofing symmetry — the PDF's
                         CreationDate is already pinned unconditionally, so
                         this never changes the output
  --help, -h             show this message

<file|dir>/<file> resolve relative to the content root when not absolute.
Exit codes: 0 ok, 1 validation/fit failure, 2 usage error.
`;

function valueFlag(value, name) {
  if (value === undefined) return undefined;
  if (value === true || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function resolveRequiredPath(value, fallback, name) {
  const resolved = value === undefined ? fallback : valueFlag(value, name);
  return path.resolve(resolved);
}

function resolveFrom(dataDir, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(dataDir, value);
}

/** Same `--data-dir`/`$DAYLIGHT_BASE_PATH` content-root pattern as `schoolcalc-catalog.cli.mjs`. */
export function resolveSchoolDocsContentPaths({ flags = {}, env = process.env } = {}) {
  const dataDir = resolveRequiredPath(
    flags['data-dir'],
    env.DAYLIGHT_BASE_PATH ? path.join(env.DAYLIGHT_BASE_PATH, 'data') : '/usr/src/app/data',
    '--data-dir',
  );
  const contentRoot = resolveFrom(
    dataDir,
    valueFlag(flags['content-root'], '--content-root') ?? 'content/school/print-documents',
  );
  return { dataDir, contentRoot };
}

/** A bare positional arg resolves relative to the content root; absolute paths pass through. */
function resolveContentPath(paths, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(paths.contentRoot, value);
}

function loadYamlDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content);
}

/** Non-recursive `*.yml` walk, sorted — mirrors `YamlPrintDocumentRepository`'s flat convention. */
function listYmlFilesFlat(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .map((entry) => entry.name)
    .sort();
}

function validateOneFile(filePath) {
  let raw;
  try {
    raw = loadYamlDocument(filePath);
  } catch (error) {
    return { errors: [`YAML parse error: ${error.message}`] };
  }
  return validateAnyDocument(raw);
}

/**
 * @param {{target: string}} args - `target` already resolved to an absolute path
 * @returns {{ok: boolean, mode: 'validate', target: string, files: Array, errors: string[]}}
 */
export function runValidate({ target }) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return {
      ok: false, mode: 'validate', target, files: [], errors: [`no such file or directory: ${target}`],
    };
  }

  const isDirectory = stat.isDirectory();
  const filePaths = isDirectory
    ? listYmlFilesFlat(target).map((name) => path.join(target, name))
    : [target];

  const files = filePaths.map((filePath) => {
    const { errors } = validateOneFile(filePath);
    return { file: isDirectory ? path.relative(target, filePath) : filePath, ok: errors.length === 0, errors };
  });

  const errors = files.flatMap(({ file, errors: fileErrors }) => fileErrors.map((message) => (
    isDirectory ? `${file}: ${message}` : message
  )));

  return {
    ok: errors.length === 0, mode: 'validate', target, files, errors,
  };
}

/** Applies `--type-scale`'s proofing override onto `document.fit.typeScale` (v2 only has `fit`). */
function applyRenderOverrides(raw, flags) {
  if (flags['type-scale'] === undefined) return raw;
  return { ...raw, fit: { ...(raw.fit ?? {}), typeScale: flags['type-scale'] } };
}

function overridesContext(flags) {
  const context = {};
  if (flags['learner-name'] !== undefined) context.learnerName = flags['learner-name'];
  if (flags.date !== undefined) context.date = flags.date;
  return context;
}

/**
 * Phase A proofing-flag warnings, surfaced through `report.warnings` so a
 * caller (especially an AI repair loop) gets a runtime signal instead of
 * silent no-op behavior: `--density`/`--creation-date` are accepted and
 * shape-validated but never change rendered output (see the module
 * docstring — `DocumentPdfRenderer` pins `CreationDate` unconditionally and
 * the document schema has no `density` field for anything to read).
 * `--type-scale` DOES work, but only on v2 documents — v1 (legacy) has no
 * `fit`, so the override applied by `applyRenderOverrides` is itself a
 * silent no-op there too.
 */
function proofingFlagWarnings(raw, flags) {
  const warnings = [];
  if (flags.density !== undefined) {
    warnings.push('--density is accepted but has no effect in Phase A; density is chosen automatically by the fit solver');
  }
  if (flags['creation-date'] !== undefined) {
    warnings.push('renders are always deterministic; --creation-date has no effect');
  }
  if (flags['type-scale'] !== undefined && raw?.schema !== DOCUMENT_V2_SCHEMA) {
    warnings.push('--type-scale is accepted but has no effect on this v1 (legacy) document; only v2 documents have a fit.typeScale');
  }
  return warnings;
}

/**
 * @param {{filePath: string, outPath: string, flags: object}} args
 * @returns {Promise<{ok: boolean, mode: 'render', file: string, out: string,
 *   pages: number|null, density: string|null, warnings: string[], errors: string[]}>}
 */
export async function runRender({ filePath, outPath, flags }) {
  let raw;
  try {
    raw = loadYamlDocument(filePath);
  } catch (error) {
    return {
      ok: false,
      mode: 'render',
      file: filePath,
      out: outPath,
      pages: null,
      density: null,
      warnings: [],
      errors: [`YAML parse error: ${error.message}`],
    };
  }

  const document = applyRenderOverrides(raw, flags);
  const extraWarnings = proofingFlagWarnings(raw, flags);
  const useCase = new RenderPrintDocument();

  try {
    const result = await useCase.execute({ document, context: overridesContext(flags) });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.bytes);
    return {
      ok: true,
      mode: 'render',
      file: filePath,
      out: outPath,
      pages: result.pageCount,
      density: result.density,
      warnings: [...extraWarnings, ...result.warnings],
      errors: [],
    };
  } catch (error) {
    const oversetPt = error?.details?.oversetPt;
    const message = oversetPt !== undefined
      ? `${error.message} (oversetPt: ${oversetPt})`
      : (error?.message ?? String(error));
    return {
      ok: false,
      mode: 'render',
      file: filePath,
      out: outPath,
      pages: null,
      density: null,
      warnings: extraWarnings,
      errors: [message],
    };
  }
}

function usageResult(errors) {
  return {
    exitCode: EXIT_USAGE,
    report: {
      ok: false, mode: 'usage', errors, warnings: [],
    },
  };
}

/**
 * @param {string[]} argv
 * @param {{env?: object}} [deps] - injectable for tests (`env` feeds content-root resolution)
 * @returns {Promise<{exitCode: number, report: object}>}
 */
export async function runSchoolDocs(argv = [], deps = {}) {
  const {
    subcommand, positional, flags, help,
  } = parseArgv(argv);

  if (help || !subcommand) {
    return {
      exitCode: help ? EXIT_OK : EXIT_USAGE,
      report: {
        ok: !!help, mode: 'help', errors: [], warnings: [],
      },
    };
  }

  if (subcommand !== 'validate' && subcommand !== 'render') {
    return usageResult([`Unknown command: ${subcommand}`]);
  }

  const allowedFlags = subcommand === 'validate' ? VALIDATE_FLAGS : RENDER_FLAGS;
  const unknown = Object.keys(flags).filter((flag) => !allowedFlags.has(flag));
  if (unknown.length) {
    return usageResult(unknown.map((flag) => `Unknown option: --${flag}`));
  }

  let paths;
  try {
    paths = resolveSchoolDocsContentPaths({ flags, env: deps.env ?? process.env });
  } catch (error) {
    return usageResult([error.message]);
  }

  if (subcommand === 'validate') {
    if (positional.length !== 1) {
      return usageResult(['validate requires exactly one <file|dir> argument']);
    }
    const report = runValidate({ target: resolveContentPath(paths, positional[0]) });
    return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
  }

  // render
  if (positional.length !== 1) {
    return usageResult(['render requires exactly one <file> argument']);
  }
  let outValue;
  try {
    outValue = valueFlag(flags.out, '--out');
  } catch (error) {
    return usageResult([error.message]);
  }
  if (outValue === undefined) {
    return usageResult(['--out needs a path']);
  }
  if (flags.density !== undefined && (flags.density === true || !DENSITIES.has(flags.density))) {
    return usageResult([`--density must be one of: ${[...DENSITIES].join(', ')}`]);
  }
  if (flags['creation-date'] !== undefined) {
    const raw = flags['creation-date'];
    if (raw === true || Number.isNaN(Date.parse(raw))) {
      return usageResult(['--creation-date needs a valid ISO date string']);
    }
  }

  const filePath = resolveContentPath(paths, positional[0]);
  const outPath = path.isAbsolute(outValue) ? path.resolve(outValue) : path.resolve(process.cwd(), outValue);
  const report = await runRender({ filePath, outPath, flags });
  return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
}

export function formatSchoolDocsReport(report) {
  if (report.mode === 'validate') {
    const lines = [`school:docs validate ${report.target}`];
    report.files.forEach(({ file, ok, errors }) => {
      lines.push(`  ${file}  ${ok ? 'OK' : 'FAILED'}`);
      errors.forEach((error) => lines.push(`    - ${error}`));
    });
    if (!report.files.length) lines.push('  (no *.yml files found)');
    lines.push('', report.ok ? 'OK' : 'FAILED');
    return `${lines.join('\n')}\n`;
  }

  if (report.mode === 'render') {
    if (report.ok) {
      const lines = [JSON.stringify({ pages: report.pages, density: report.density })];
      if (report.warnings.length) {
        lines.push('', 'Warnings');
        report.warnings.forEach((warning) => lines.push(`  - ${warning}`));
      }
      return `${lines.join('\n')}\n`;
    }
    const lines = ['FAILED', ...report.errors.map((error) => `  - ${error}`)];
    if (report.warnings.length) {
      lines.push('', 'Warnings');
      report.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    }
    return `${lines.join('\n')}\n`;
  }

  return report.errors.length ? `${report.errors.map((error) => `ERROR: ${error}`).join('\n')}\n` : '';
}

export async function main(argv = process.argv.slice(2), io = process) {
  const { exitCode, report } = await runSchoolDocs(argv);
  if (report.mode === 'help') {
    io.stdout.write(HELP);
    return exitCode;
  }
  if (report.mode === 'usage') {
    io.stderr.write(formatSchoolDocsReport(report));
    io.stdout.write(HELP);
    return exitCode;
  }
  io.stdout.write(formatSchoolDocsReport(report));
  return exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRYPOINT) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = EXIT_FAIL;
    });
}
