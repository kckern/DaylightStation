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
 *
 * `publish <file>` (Task 6, spec §3/§10) runs `PublishPrintDocument` against
 * a `YamlPrintDocumentRepository` rooted at the SAME content root `validate`/
 * `render` resolve against — the published document + derived bank land at
 * `<content-root>/published/<id>@<rev>.yml` and
 * `<content-root>/derived-banks/<id>@<rev>.yml`, append-only. `render` wires
 * the identical repository so a PUBLISHED file (one with a `rev`, e.g. one
 * `publish` just wrote) can resolve its own derived bank at render time —
 * needed for any inline `omr_response` and for `--teacher` on a published
 * document; a SOURCE-schema file needs no repository at all (`render` always
 * auto-publishes it in memory, spec §3).
 *
 * `--teacher` (Task 6, spec §4.1/§12.1) is a RENDER MODE, not a different
 * command: it prints the identical student pages the same `render` call
 * would have produced without it, then appends a dense answer-key section.
 * Works on a SOURCE file (in-memory publish resolves the bank) or a
 * PUBLISHED file whose derived bank the repository above can resolve; a
 * hand-authored v2 file with no bank-bearing content renders a bare heading
 * and surfaces a warning (`RenderPrintDocument`'s own "no answerable items"
 * warning), never a hard failure.
 *
 * `render --card <id>|--fresh-card [--start-row <n>]` (Task 7, spec §5.3/§5.4/
 * §9/§10) attaches the render to a physical OMR card via a `YamlAllocationStore`
 * rooted at the SAME content root — `<content-root>/allocations/<cardId>.yml`,
 * `YamlAllocationStore`'s own convention. Only a PUBLISHED document (one
 * carrying `rev`) can attach to a card (`RenderPrintDocument`'s own
 * `ALLOCATION_REQUIRES_REV`); the store is constructed only when one of these
 * flags is present, so a plain proof render never touches the allocations
 * directory. The allocation result (`{cardId, rowRange, recordId, status}`)
 * prints alongside `{pages, density}` on success.
 *
 * `release-card <cardId> [--rows a-b]` (Task 7, spec §5.4) is allocation
 * lifecycle housekeeping — `YamlAllocationStore#release`, against the same
 * content-root-rooted store `render`'s card flags use. Prints the records it
 * released (empty array when nothing was `live`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseArgv } from './_argv.mjs';
import { validateAnyDocument, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { RenderPrintDocument, createYamlBankReader } from '#apps/school/documents/RenderPrintDocument.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);

const DENSITIES = new Set(['normal', 'compact']);
const V2_LIKE_SCHEMAS = new Set([DOCUMENT_V2_SCHEMA, DOCUMENT_SOURCE_SCHEMA]);

const COMMON_FLAGS = new Set(['data-dir', 'content-root']);
const VALIDATE_FLAGS = new Set([...COMMON_FLAGS]);
const PUBLISH_FLAGS = new Set([...COMMON_FLAGS]);
const RENDER_FLAGS = new Set([
  ...COMMON_FLAGS,
  'out',
  'learner-name',
  'date',
  'type-scale',
  'density',
  'creation-date',
  'teacher',
  'card',
  'start-row',
  'fresh-card',
]);
const RELEASE_CARD_FLAGS = new Set([...COMMON_FLAGS, 'rows']);

const HELP = `school-docs — validate and proof-render School print-document source YAML

Usage:
  school-docs.cli.mjs validate <file|dir> [options]
  school-docs.cli.mjs publish <file> [options]
  school-docs.cli.mjs render <file> --out <pdf> [options]
  school-docs.cli.mjs release-card <cardId> [options]

Commands:
  validate <file|dir>   parse + validateAnyDocument (v1 or v2); directory form
                         walks *.yml (non-recursive). Render-free, sub-second.
  publish <file>         compile a school.document-source/v1 file into a
                         published document + derived question bank, written
                         under the content root (append-only per revision).
  render <file>          run the real fit/render pipeline and write a PDF.
  release-card <cardId>  release live allocation records on a physical card
                         (whole card, or just the rows named by --rows).

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
  --teacher              (render) teacher-key mode: same student pages, plus
                         an appended dense answer-key section (v2/source only)
  --card <cardId>        (render) attach to an existing physical card (reprint/
                         continuation) — requires a PUBLISHED document (rev)
  --fresh-card           (render) mint a brand-new physical card allocation —
                         mutually exclusive with --card
  --start-row <n>        (render) first physical row to allocate (default 1);
                         only meaningful alongside --card or --fresh-card
  --rows <a-b>            (release-card) release only rows a..b (inclusive);
                         omitted releases every live record on the card
  --help, -h             show this message

<file|dir>/<file> resolve relative to the content root when not absolute.
Exit codes: 0 ok, 1 validation/fit/publish/release failure, 2 usage error.
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

/** `--rows a-b` (release-card, Task 7) -> `{start, end}` or a usage error message; absent -> `{rows: null}` (whole card). */
function parseRowRangeFlag(value, name) {
  if (value === undefined) return { rows: null, error: null };
  if (value === true || typeof value !== 'string') return { rows: null, error: `${name} needs a value` };
  const match = /^(\d+)-(\d+)$/.exec(value.trim());
  if (!match) return { rows: null, error: `${name} must be formatted as a-b (e.g. 5-12)` };
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end < start) return { rows: null, error: `${name} must satisfy 1 <= start <= end` };
  return { rows: { start, end }, error: null };
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
  // `--teacher` (Task 6): a render MODE, not a variant — see the module
  // docstring. Usage-validated (must be a bare flag, no value) before this
  // ever runs — see `runSchoolDocs`'s render branch.
  if (flags.teacher === true) context.teacher = true;
  // Card attachment (Task 7, spec §5.3): shape/exclusivity already validated
  // by `runSchoolDocs`'s render branch before this runs — `--card`/
  // `--fresh-card` are mutually exclusive, `--start-row` parses as a positive
  // integer when present.
  if (flags.card !== undefined) context.cardId = flags.card;
  if (flags['fresh-card'] === true) context.freshCard = true;
  if (flags['start-row'] !== undefined) context.startRow = Number(flags['start-row']);
  return context;
}

/** `true` when the render context asked to attach to a card (--card or --fresh-card). */
function wantsCardContext(flags) {
  return flags.card !== undefined || flags['fresh-card'] === true;
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
  // `--teacher` is a v2/source-only render mode (RenderPrintDocument's
  // `#renderLegacy` never reads `context.teacher`) — a v1 (legacy, schema-
  // less) document renders exactly as it would without the flag.
  if (flags.teacher === true && !V2_LIKE_SCHEMAS.has(raw?.schema)) {
    warnings.push('--teacher is accepted but has no effect on this v1 (legacy) document; only v2 documents have a teacher key');
  }
  return warnings;
}

/**
 * @param {{filePath: string, outPath: string, flags: object, paths: {contentRoot: string}}} args
 * @returns {Promise<{ok: boolean, mode: 'render', file: string, out: string,
 *   pages: number|null, density: string|null, allocation: object|null,
 *   warnings: string[], errors: string[]}>}
 */
export async function runRender({
  filePath, outPath, flags, paths,
}) {
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
      allocation: null,
      warnings: [],
      errors: [`YAML parse error: ${error.message}`],
    };
  }

  const document = applyRenderOverrides(raw, flags);
  const extraWarnings = proofingFlagWarnings(raw, flags);
  // Same content root `publish`/`validate` resolve against (spec §10): a
  // PUBLISHED file (one with a `rev`, e.g. one `publish` just wrote) resolves
  // its own derived bank through this repository — needed for any inline
  // `omr_response` and for `--teacher` on a published document.
  // Source-schema files never need it (`RenderPrintDocument` auto-publishes
  // them in memory), and a repository this use case never calls is inert.
  const repository = new YamlPrintDocumentRepository({ directory: paths.contentRoot });
  // F5 (review finding): rooted at THIS command's own resolved `dataDir` (the
  // same `--data-dir`/`$DAYLIGHT_BASE_PATH` value `paths` already carries) —
  // without this, `RenderPrintDocument`'s constructor default silently
  // re-resolves `$DAYLIGHT_BASE_PATH` itself, so a bank-select document
  // rendered with `--data-dir <custom>` would resolve its bank against the
  // WRONG root (or find nothing) whenever that env var differs from the flag.
  const banks = createYamlBankReader({ dataDir: paths.dataDir });
  // Allocation store (Task 7, spec §5.3/§5.4): constructed ONLY when the
  // caller actually asked to attach to a card (`--card`/`--fresh-card`) — a
  // plain proof render never touches the allocations directory. Rooted at
  // the SAME content root as `repository` above, mirroring
  // `YamlAllocationStore`'s own directory convention (siblings of
  // `published/`/`derived-banks/`).
  const allocationStore = wantsCardContext(flags)
    ? new YamlAllocationStore({ directory: paths.contentRoot })
    : null;
  const useCase = new RenderPrintDocument({ repository, banks, allocationStore });

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
      allocation: result.allocation ?? null,
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
      allocation: null,
      warnings: extraWarnings,
      errors: [message],
    };
  }
}

/**
 * `release-card <cardId> [--rows a-b]` (Task 7, spec §5.4): allocation
 * lifecycle housekeeping against a `YamlAllocationStore` rooted at the SAME
 * content root `render`'s card flags use. Never touches the print-document
 * repository — cards are pure allocation-store state.
 *
 * @param {{cardId: string, rows: {start: number, end: number}|null, paths: {contentRoot: string}}} args
 * @returns {Promise<{ok: boolean, mode: 'release-card', cardId: string,
 *   rows: {start: number, end: number}|null, released: object[], errors: string[]}>}
 */
export async function runReleaseCard({ cardId, rows, paths }) {
  const allocationStore = new YamlAllocationStore({ directory: paths.contentRoot });
  try {
    const released = await allocationStore.release({ cardId, rows: rows ?? undefined });
    return {
      ok: true, mode: 'release-card', cardId, rows, released, errors: [],
    };
  } catch (error) {
    return {
      ok: false, mode: 'release-card', cardId, rows, released: [], errors: [error?.message ?? String(error)],
    };
  }
}

/**
 * `publish <file>` (Task 6, spec §3/§10): compile a `school.document-source/v1`
 * file into a published document + derived question bank, persisted
 * append-only under `paths.contentRoot` via `YamlPrintDocumentRepository`
 * (`<content-root>/published/<id>@<rev>.yml`,
 * `<content-root>/derived-banks/<id>@<rev>.yml`). Any failure — YAML parse,
 * source-stage validation, the publish transform's own answer-free/
 * bank-shape POSTCONDITION checks, or the repository's append-only conflict
 * guard — surfaces here as `errors` (exit 1 at the `runSchoolDocs` level);
 * none of them are distinguished further, since every one is "this file did
 * not publish" from the CLI's point of view.
 *
 * @param {{filePath: string, paths: {contentRoot: string}}} args
 * @returns {Promise<{ok: boolean, mode: 'publish', file: string,
 *   id: string|null, rev: string|null, bankId: string|null,
 *   warnings: string[], errors: string[]}>}
 */
export async function runPublish({ filePath, paths }) {
  let raw;
  try {
    raw = loadYamlDocument(filePath);
  } catch (error) {
    return {
      ok: false, mode: 'publish', file: filePath, id: null, rev: null, bankId: null, warnings: [], errors: [`YAML parse error: ${error.message}`],
    };
  }

  const repository = new YamlPrintDocumentRepository({ directory: paths.contentRoot });
  const useCase = new PublishPrintDocument({ repository });

  try {
    const result = await useCase.execute({ source: raw });
    return {
      ok: true,
      mode: 'publish',
      file: filePath,
      id: result.id,
      rev: result.rev,
      bankId: result.bankId,
      warnings: result.warnings,
      errors: [],
    };
  } catch (error) {
    return {
      ok: false, mode: 'publish', file: filePath, id: null, rev: null, bankId: null, warnings: [], errors: [error?.message ?? String(error)],
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

  const KNOWN_COMMANDS = new Set(['validate', 'publish', 'render', 'release-card']);
  if (!KNOWN_COMMANDS.has(subcommand)) {
    return usageResult([`Unknown command: ${subcommand}`]);
  }

  const allowedFlags = {
    validate: VALIDATE_FLAGS, publish: PUBLISH_FLAGS, render: RENDER_FLAGS, 'release-card': RELEASE_CARD_FLAGS,
  }[subcommand];
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

  if (subcommand === 'publish') {
    if (positional.length !== 1) {
      return usageResult(['publish requires exactly one <file> argument']);
    }
    const filePath = resolveContentPath(paths, positional[0]);
    const report = await runPublish({ filePath, paths });
    return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
  }

  if (subcommand === 'release-card') {
    if (positional.length !== 1) {
      return usageResult(['release-card requires exactly one <cardId> argument']);
    }
    const { rows, error: rowsError } = parseRowRangeFlag(flags.rows, '--rows');
    if (rowsError) return usageResult([rowsError]);
    const report = await runReleaseCard({ cardId: positional[0], rows, paths });
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
  // `--teacher` is a bare mode flag (no value) — see the module docstring.
  if (flags.teacher !== undefined && flags.teacher !== true) {
    return usageResult(['--teacher does not take a value']);
  }
  // Card attachment (Task 7, spec §5.3): `--card` needs a value, `--fresh-card`
  // is a bare mode flag (mirrors `--teacher`), the two are mutually exclusive
  // (one physical card per render — supplying both is an ambiguous request,
  // never silently resolved by picking one), and `--start-row` only means
  // anything alongside one of them.
  if (flags.card === true) {
    return usageResult(['--card needs a value']);
  }
  if (flags['fresh-card'] !== undefined && flags['fresh-card'] !== true) {
    return usageResult(['--fresh-card does not take a value']);
  }
  if (flags.card !== undefined && flags['fresh-card'] === true) {
    return usageResult(['--card and --fresh-card are mutually exclusive']);
  }
  if (flags['start-row'] !== undefined) {
    if (!wantsCardContext(flags)) {
      return usageResult(['--start-row requires --card or --fresh-card']);
    }
    const raw = flags['start-row'];
    if (raw === true || !/^\d+$/.test(raw) || Number(raw) < 1) {
      return usageResult(['--start-row must be a positive integer']);
    }
  }

  const filePath = resolveContentPath(paths, positional[0]);
  const outPath = path.isAbsolute(outValue) ? path.resolve(outValue) : path.resolve(process.cwd(), outValue);
  const report = await runRender({
    filePath, outPath, flags, paths,
  });
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

  if (report.mode === 'publish') {
    if (report.ok) {
      const lines = [JSON.stringify({ id: report.id, rev: report.rev, bankId: report.bankId })];
      if (report.warnings.length) {
        lines.push('', 'Warnings');
        report.warnings.forEach((warning) => lines.push(`  - ${warning}`));
      }
      return `${lines.join('\n')}\n`;
    }
    const lines = ['FAILED', ...report.errors.map((error) => `  - ${error}`)];
    return `${lines.join('\n')}\n`;
  }

  if (report.mode === 'render') {
    if (report.ok) {
      // `allocation` only when the render actually attached to a card
      // (`--card`/`--fresh-card`) — a plain proof render's output stays
      // exactly what it always was.
      const payload = { pages: report.pages, density: report.density };
      if (report.allocation) payload.allocation = report.allocation;
      const lines = [JSON.stringify(payload)];
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

  if (report.mode === 'release-card') {
    if (report.ok) {
      return `${JSON.stringify({ cardId: report.cardId, rows: report.rows, released: report.released })}\n`;
    }
    const lines = ['FAILED', ...report.errors.map((error) => `  - ${error}`)];
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
