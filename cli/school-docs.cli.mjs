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
 * TWO ROOTS. `--source-root` (default `content/school/catalog/documents`) is
 * where hand-authored document CLASSES live, on the School catalog shelf
 * beside the `school.learning-document/v1` files; `--content-root` (default
 * `content/school/print-documents`) is the ARTIFACT root — `published/`,
 * `derived-banks/`, `allocations/` and nothing else. A non-absolute positional
 * resolves against the source root first and the content root second (see
 * `resolveDocumentPath`), which is what keeps a `published/<id>@<rev>.yml`
 * argument and a legacy content-root-only layout both working.
 *
 * `publish <file>` (Task 6, spec §3/§10) runs `PublishPrintDocument` against
 * a `YamlPrintDocumentRepository` spanning both roots — the published document
 * + derived bank land at
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
 * Card mode ALWAYS resolves the PUBLISHED document via the repository (re-
 * review wave 2, F2), never `<file>`'s own on-disk content: rendering the
 * source directly would let its in-memory auto-publish mint a rev that
 * disagrees with whatever the last real `publish` actually persisted, and
 * the allocation record would pin that phantom rev — a scan of the printed
 * card could then never resolve it back. `<file>` only supplies the
 * document `id` to look up in this mode; pass either the source file or a
 * `published/` copy, they resolve to the same place. An id with no
 * published revision fails with an instructive error (run `publish` first)
 * rather than silently falling back to the source.
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
import { buildReprintContext } from '#apps/school/documents/reprintContext.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { SAFE_WORKSHEET_INSTANCE_ID } from '#adapters/persistence/yaml/YamlWorksheetInstanceStore.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);

const DENSITIES = new Set(['normal', 'compact']);
const V2_LIKE_SCHEMAS = new Set([DOCUMENT_V2_SCHEMA, DOCUMENT_SOURCE_SCHEMA]);

const COMMON_FLAGS = new Set(['data-dir', 'content-root', 'source-root']);

/** Artifact subtrees under the CONTENT root — never hand-authored, never walked by `validate <dir>`. */
const ARTIFACT_DIRS = new Set(['published', 'derived-banks', 'allocations']);
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
  'learner-id',
]);
const RELEASE_CARD_FLAGS = new Set([...COMMON_FLAGS, 'rows']);
const LIST_CARDS_FLAGS = new Set([...COMMON_FLAGS, 'status', 'older-than']);
const REPRINT_FLAGS = new Set([...COMMON_FLAGS, 'out']);

const HELP = `school-docs — validate and proof-render School print-document source YAML

Usage:
  school-docs.cli.mjs validate <file|dir> [options]
  school-docs.cli.mjs publish <file> [options]
  school-docs.cli.mjs render <file> --out <pdf> [options]
  school-docs.cli.mjs release-card <cardId> [options]
  school-docs.cli.mjs list-cards [options]
  school-docs.cli.mjs reprint <instanceId> --out <pdf>

Commands:
  validate <file|dir>   parse + validateAnyDocument (v1 or v2); directory form
                         walks *.yml recursively, skipping the artifact
                         subtrees and any file declaring another system's
                         schema (e.g. school.learning-document/v1).
                         Render-free, sub-second.
  publish <file>         compile a school.document-source/v1 file into a
                         published document + derived question bank, written
                         under the content root (append-only per revision).
  render <file>          run the real fit/render pipeline and write a PDF.
  release-card <cardId>  release live allocation records on a physical card
                         (whole card, or just the rows named by --rows).
  list-cards             every allocation record across every card — the read
                         release-card never had (admin advocacy A5: stranded
                         live cards were a documented leak with no tool to
                         find them). Filter with --status / --older-than.
  reprint <instanceId>   reproduce an exact historical print from a
                         persisted worksheet-instance file — same learner
                         name, date, card number, row range, question
                         order/content — no manual flags needed.

Options:
  --data-dir <path>      data root (default: $DAYLIGHT_BASE_PATH/data)
  --content-root <path>  ARTIFACT root, absolute or data-relative — where
                         published/, derived-banks/ and allocations/ live
                         (default: content/school/print-documents)
  --source-root <path>   authored SOURCE root, absolute or data-relative —
                         where hand-written document classes live, on the
                         School catalog shelf beside the learning documents
                         (default: content/school/catalog/documents)
  --out <path>           (render/reprint) output PDF path — required
  --learner-name <s>     (render) prefill the header Name line
  --date <s>             (render) prefill the header Date line
  --type-scale <s>       (render) override document.fit.typeScale for proofing
  --density <normal|compact>  (render) accepted for proofing symmetry
  --creation-date <iso>  (render) accepted for proofing symmetry — the PDF's
                         CreationDate is already pinned unconditionally, so
                         this never changes the output
  --teacher              (render) teacher-key mode: same student pages, plus
                         an appended dense answer-key section (v2/source only)
  --learner-id <id>      (render) bind a card allocation to a student — who
                         this sheet belongs to. Without it a card allocation
                         is anonymous, and two siblings' scans of the same
                         document cannot be told apart.
  --card <cardId>        (render) attach to an existing physical card (reprint/
                         continuation) — requires a PUBLISHED document (rev)
  --fresh-card           (render) mint a brand-new physical card allocation —
                         mutually exclusive with --card
  --start-row <n>        (render) first physical row to allocate (default 1);
                         only meaningful alongside --card or --fresh-card
  --status <s>            (list-cards) only records with this status (e.g. live)
  --older-than <Nd>       (list-cards) only records rendered more than N days ago
  --rows <a-b>            (release-card) release only rows a..b (inclusive);
                         omitted releases every live record on the card
  --help, -h             show this message

A non-absolute <file|dir>/<file> resolves against the SOURCE root first, then
against the CONTENT root if it does not exist there (so a published/<id>@<rev>
file, and a legacy content-root-only layout, both still work). Absolute paths
pass through untouched.
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

/**
 * Same `--data-dir`/`$DAYLIGHT_BASE_PATH` pattern as `schoolcalc-catalog.cli.mjs`,
 * over the two roots this CLI now spans:
 *
 * - `contentRoot` (`--content-root`) — the ARTIFACT root. `publish` writes
 *   `published/` + `derived-banks/` here and every card allocation lives here.
 * - `sourceRoot` (`--source-root`) — the hand-authored SOURCE root, on the
 *   School catalog shelf. A document CLASS is authored here; its published
 *   objects land under `contentRoot`.
 */
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
  const sourceRoot = resolveFrom(
    dataDir,
    valueFlag(flags['source-root'], '--source-root') ?? 'content/school/catalog/documents',
  );
  return { dataDir, contentRoot, sourceRoot };
}

/**
 * Resolves a bare (non-absolute) `<file|dir>` positional. Absolute paths always
 * pass through untouched.
 *
 * SOURCE ROOT FIRST, CONTENT ROOT SECOND. Sources moved out of the artifact
 * root, so `validate`/`publish`/`render`'s positional now means "relative to
 * `--source-root`" — that is where the thing you are about to validate,
 * publish or proof-render is authored. But the content root stays a live
 * second candidate, tried only when the first does not exist on disk: a
 * `published/<id>@<rev>.yml` file is a legitimate `render` argument, a
 * deployment (or a caller) that still passes only `--content-root` with its
 * sources inside must keep working, and neither case is ambiguous in practice
 * because a given relative path exists under exactly one of the two.
 *
 * When it exists under NEITHER, the source-root candidate is returned, so the
 * resulting "no such file" names the root the caller was most likely aiming at.
 */
function resolveDocumentPath(paths, value) {
  if (path.isAbsolute(value)) return path.resolve(value);
  const fromSource = path.resolve(paths.sourceRoot, value);
  if (fs.existsSync(fromSource)) return fromSource;
  const fromContent = path.resolve(paths.contentRoot, value);
  if (fs.existsSync(fromContent)) return fromContent;
  return fromSource;
}

/** Both roots, wired the way every command needs them (`list()` reads sources, artifacts are written/read under the content root). */
function openRepository(paths) {
  return new YamlPrintDocumentRepository({
    directory: paths.contentRoot,
    sourceDirectory: paths.sourceRoot,
  });
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

/**
 * RECURSIVE `*.yml` walk, sorted, returning root-relative paths — mirrors
 * `YamlPrintDocumentRepository.list()`.
 *
 * Recursive because source ids are taxonomy paths and their files nest under
 * them (`arts/pokemon-identification/quiz-1.yml`): a non-recursive walk of the
 * source root would report zero files for exactly the documents that exist.
 * The three artifact subtrees are skipped at the top level so pointing this at
 * the CONTENT root still means "the hand-authored things", never the
 * machine-written `published/`/`derived-banks/`/`allocations/` output (a
 * derived bank is not a document and would fail `validateAnyDocument`).
 */
function listYmlFilesRecursive(directory) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (prefix === '' && ARTIFACT_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && entry.name.endsWith('.yml')) {
        out.push(relative);
      }
    }
  };
  walk(directory, '');
  return out.sort();
}

/**
 * Directory form only. The source root is the School catalog shelf, SHARED
 * with the learning-document system, so a walk will meet `documentId`-keyed
 * `school.learning-document/v1` files that this CLI has no business
 * validating — reporting them as failures would make `validate <dir>` red for
 * files it does not own.
 *
 * The test is on a DECLARED schema, not on absence: a file with no `schema`
 * key at all is a legacy v1 print document and is still ours to check. A file
 * named explicitly on the command line is always validated, whatever it
 * declares — the caller asked for that file by name.
 */
function isForeignSchema(raw) {
  const schema = raw?.schema;
  return typeof schema === 'string' && !V2_LIKE_SCHEMAS.has(schema);
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
 * @returns {{ok: boolean, mode: 'validate', target: string, files: Array,
 *   skipped: string[], errors: string[]}} `skipped` names the files a
 *   directory walk passed over as belonging to another system (see
 *   `isForeignSchema`) — reported rather than swallowed, so a source that was
 *   skipped because of a typo'd `schema:` is visible instead of invisible.
 */
export function runValidate({ target }) {
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return {
      ok: false, mode: 'validate', target, files: [], skipped: [], errors: [`no such file or directory: ${target}`],
    };
  }

  const isDirectory = stat.isDirectory();
  const filePaths = isDirectory
    ? listYmlFilesRecursive(target).map((name) => path.join(target, name))
    : [target];

  const skipped = [];
  const files = [];
  for (const filePath of filePaths) {
    const relative = isDirectory ? path.relative(target, filePath) : filePath;
    if (isDirectory) {
      let raw;
      try {
        raw = loadYamlDocument(filePath);
      } catch {
        raw = null; // unparsable: fall through and let `validateOneFile` report it
      }
      if (isForeignSchema(raw)) {
        skipped.push(relative);
        continue;
      }
    }
    const { errors } = validateOneFile(filePath);
    files.push({ file: relative, ok: errors.length === 0, errors });
  }

  const errors = files.flatMap(({ file, errors: fileErrors }) => fileErrors.map((message) => (
    isDirectory ? `${file}: ${message}` : message
  )));

  return {
    ok: errors.length === 0, mode: 'validate', target, files, skipped, errors,
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
  if (flags['learner-id'] !== undefined) context.learnerId = flags['learner-id'];
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

  // Same content root `publish`/`validate` resolve against (spec §10): a
  // PUBLISHED file (one with a `rev`, e.g. one `publish` just wrote) resolves
  // its own derived bank through this repository — needed for any inline
  // `omr_response` and for `--teacher` on a published document.
  // Source-schema files never need it (`RenderPrintDocument` auto-publishes
  // them in memory), and a repository this use case never calls is inert.
  const repository = openRepository(paths);
  const cardMode = wantsCardContext(flags);

  // Card-attach lane (re-review wave 2, F2: phantom-rev trap). A card-attach
  // render must pin the SAME rev the allocation record persists, and the
  // allocation store's rev comes straight off whatever `document` gets
  // handed to `RenderPrintDocument` — for a SOURCE-schema file that is an
  // IN-MEMORY publish computed fresh from `filePath`'s CURRENT on-disk
  // content (see the `#renderV2`/`publishDocument` path below), not the
  // repository's own persisted rev. If the source has drifted since the
  // last real `publish` — even a cosmetic edit — that in-memory publish
  // mints a rev `getPublished` can never serve, so the allocation record
  // pins a phantom: the physical card prints fine, but the child's scan can
  // never resolve it back (spec §5.2's "one resolver, no parallel mapping"
  // depends on the rev it resolves against actually existing). So whenever
  // card context is requested, this loads the PUBLISHED document for the
  // file's own `id` through the SAME repository the allocation store
  // shares, and renders THAT — never the possibly-drifted source — with any
  // proofing overrides (`--type-scale`) still applied on top. No published
  // rev at all means there is nothing safe to pin: fail loudly rather than
  // silently falling back to the source, which is exactly the phantom-rev
  // trap this guards against. A plain proof render (no card flags) is
  // unaffected — it keeps rendering `raw` exactly as loaded.
  let base = raw;
  if (cardMode) {
    const documentId = typeof raw?.id === 'string' && raw.id.trim() ? raw.id : null;
    const published = documentId ? await repository.getPublished(documentId) : null;
    if (!published) {
      return {
        ok: false,
        mode: 'render',
        file: filePath,
        out: outPath,
        pages: null,
        density: null,
        allocation: null,
        warnings: [],
        errors: [
          documentId
            ? `document '${documentId}' has no published revision; run 'school-docs publish ${filePath}' first — a card-attach render must pin a rev the allocation store can actually resolve later, never the source file's current (possibly drifted) content`
            : `'${filePath}' has no document id; a card-attach render needs one to resolve its published revision`,
        ],
      };
    }
    base = published;
  }

  const document = applyRenderOverrides(base, flags);
  const extraWarnings = proofingFlagWarnings(raw, flags);
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
  const allocationStore = cardMode
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
 * `<dataDir>/household/apps/school/worksheet-instances/<instanceId>.yml`.
 *
 * SINGLE-HOUSEHOLD ASSUMPTION: `household/` is hardcoded here, whereas the
 * canonical reader (`YamlWorksheetInstanceStore`) resolves the same directory
 * through `configService.getHouseholdPath(...)` and therefore honours a
 * multi-household layout (`household-{hid}/`). On a multi-household install
 * this CLI only sees the default household's instances; pass `--data-dir`
 * pointed at the right tree, or teach it the hid, if that ever changes.
 *
 * The id itself IS validated with the store's own rule
 * (`SAFE_WORKSHEET_INSTANCE_ID`) before it reaches this function — an
 * unvalidated id interpolated here is a path traversal.
 */
function resolveWorksheetInstancePath(dataDir, instanceId) {
  return path.join(dataDir, 'household/apps/school/worksheet-instances', `${instanceId}.yml`);
}

/** Same rule the canonical `YamlWorksheetInstanceStore` applies, imported so the two cannot drift. */
function isSafeInstanceId(instanceId) {
  return typeof instanceId === 'string'
    && SAFE_WORKSHEET_INSTANCE_ID.test(instanceId)
    && !instanceId.includes('..');
}

/**
 * `reprint <instanceId>` (fixes the "human hand-reconstructs five flags" gap):
 * reads the ALREADY-PERSISTED worksheet instance (learner, issue date, card/
 * row assignment) and reproduces its render byte-for-byte, no flags needed.
 * Resolves the PUBLISHED document (never the raw source) the same way card
 * mode does in `runRender`, and always passes the instance's own `learnerId`/
 * `cardId`/`startRow`, which is what makes `RenderPrintDocument`'s allocation
 * store recognize this as the identical live record and return it unchanged
 * (`YamlAllocationStore.allocate`'s idempotent-reprint shortcut) rather than
 * writing a new one or colliding. When that idempotency does NOT hold — the
 * resulting recordId disagrees with the one the instance recorded — this
 * reports a FAILURE rather than a sheet nobody can scan (see below).
 *
 * @param {{instanceId: string, outPath: string, paths: {dataDir: string, contentRoot: string}}} args
 */
export async function runReprint({ instanceId, outPath, paths }) {
  /** Every failure exit from this command reports the same shape — never a thrown exception. */
  const fail = (errors) => ({
    ok: false, mode: 'reprint', instanceId, out: outPath, pages: null, density: null, allocation: null, warnings: [], errors,
  });

  if (!isSafeInstanceId(instanceId)) {
    return fail([
      `unsafe worksheet instance id '${instanceId}': an id must start with a letter or digit, `
      + "may contain only letters, digits, '.', '_', '-' and '/', and may never contain '..'. "
      + 'Refusing to build a file path from it.',
    ]);
  }

  const instancePath = resolveWorksheetInstancePath(paths.dataDir, instanceId);
  let instance;
  try {
    instance = loadYamlDocument(instancePath);
  } catch (error) {
    return fail([`could not read worksheet instance '${instanceId}' at ${instancePath}: ${error.message}`]);
  }

  // `loadYamlDocument` SUCCEEDS on an empty file (js-yaml returns `undefined`)
  // and on a bare scalar, so the shape has to be checked here — otherwise the
  // first property read throws a raw TypeError straight out of this function,
  // escaping the structured report every other path returns.
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) {
    return fail([
      `worksheet instance '${instanceId}' at ${instancePath} is empty or is not a YAML mapping; nothing to reprint`,
    ]);
  }
  const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
  const missing = [
    ...(nonEmptyString(instance.documentId) ? [] : ['documentId']),
    ...(nonEmptyString(instance.documentRevision) ? [] : ['documentRevision']),
  ];
  if (missing.length > 0) {
    return fail([
      `worksheet instance '${instanceId}' at ${instancePath} is missing required field(s): ${missing.join(', ')}. `
      + 'A reprint reproduces ONE exact historical revision, so it refuses to guess: an absent '
      + 'documentRevision would otherwise resolve to the LATEST published revision — a different '
      + 'sheet printed under the original sheet\'s name. Repair the instance file, or fall back to '
      + '`render` with explicit flags.',
    ]);
  }

  const repository = openRepository(paths);
  const published = await repository.getPublished(instance.documentId, instance.documentRevision);
  if (!published) {
    return fail([`no published revision '${instance.documentRevision}' found for document '${instance.documentId}'`]);
  }

  let context;
  try {
    context = buildReprintContext(instance);
  } catch (error) {
    return fail([error.message]);
  }

  const banks = createYamlBankReader({ dataDir: paths.dataDir });
  const allocationStore = new YamlAllocationStore({ directory: paths.contentRoot });
  const useCase = new RenderPrintDocument({ repository, banks, allocationStore });

  try {
    const result = await useCase.execute({ document: published, context });

    // POST-HOC detection: if the allocation this reprint landed on is not the
    // one the instance recorded, `YamlAllocationStore.allocate` has already
    // marked the ORIGINAL record `superseded` and appended a new live one — the
    // physical card in the filing cabinet no longer resolves on scan. The store
    // write has happened by the time we can see this; a true pre-check would
    // mean threading an expected-recordId down into `allocate` so it can refuse
    // to supersede. Noted follow-up, deliberately not built here. Reporting the
    // mismatch loudly beats the silent `ok: true` this command exists to end.
    const expectedRecordId = instance.omr?.recordId;
    const actualRecordId = result.allocation?.recordId ?? null;
    if (nonEmptyString(expectedRecordId) && actualRecordId !== expectedRecordId) {
      return fail([
        `reprint did NOT reproduce the original allocation for instance '${instanceId}': the instance `
        + `records recordId '${expectedRecordId}', but this render allocated '${actualRecordId}'. `
        + 'Do not print this sheet: an allocation for a different row range supersedes the original '
        + 'record in the store, so the card already in the filing cabinet may no longer resolve when '
        + `scanned. Inspect ${instancePath} and the allocations file for card '${instance.omr?.cardId}'.`,
      ]);
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, result.bytes);
    return {
      ok: true,
      mode: 'reprint',
      instanceId,
      out: outPath,
      pages: result.pageCount,
      density: result.density,
      allocation: result.allocation ?? null,
      warnings: result.warnings,
      errors: [],
    };
  } catch (error) {
    return fail([error?.message ?? String(error)]);
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
/**
 * `list-cards` (admin advocacy A5): every allocation record across every
 * card, flattened, filterable by status and age. This is the read that makes
 * `release-card <cardId>` usable — before it, releasing a stranded card
 * required already knowing its id.
 */
export async function runListCards({ status = null, olderThanDays = null, paths, now = Date.now() } = {}) {
  const allocationStore = new YamlAllocationStore({ directory: paths.contentRoot });
  try {
    const cutoff = olderThanDays !== null ? now - olderThanDays * 86400000 : null;
    const cards = [];
    for (const cardId of await allocationStore.listCardIds()) {
      // eslint-disable-next-line no-await-in-loop
      for (const record of await allocationStore.findByCard(cardId)) {
        if (status !== null && record.status !== status) continue;
        if (cutoff !== null && (!record.renderedAt || Date.parse(record.renderedAt) >= cutoff)) continue;
        cards.push({
          cardId,
          recordId: record.recordId,
          status: record.status,
          documentId: record.documentId,
          rev: record.rev ?? null,
          learnerId: record.learnerId ?? null,
          rowRange: record.rowRange ?? null,
          renderedAt: record.renderedAt ?? null,
        });
      }
    }
    cards.sort((a, b) => String(a.renderedAt ?? '').localeCompare(String(b.renderedAt ?? '')));
    return { ok: true, mode: 'list-cards', cards, errors: [] };
  } catch (error) {
    return { ok: false, mode: 'list-cards', cards: [], errors: [error?.message ?? String(error)] };
  }
}

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

  const repository = openRepository(paths);
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

  const KNOWN_COMMANDS = new Set(['validate', 'publish', 'render', 'release-card', 'list-cards', 'reprint']);
  if (!KNOWN_COMMANDS.has(subcommand)) {
    return usageResult([`Unknown command: ${subcommand}`]);
  }

  const allowedFlags = {
    validate: VALIDATE_FLAGS, publish: PUBLISH_FLAGS, render: RENDER_FLAGS, 'release-card': RELEASE_CARD_FLAGS, 'list-cards': LIST_CARDS_FLAGS, reprint: REPRINT_FLAGS,
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
    const report = runValidate({ target: resolveDocumentPath(paths, positional[0]) });
    return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
  }

  if (subcommand === 'publish') {
    if (positional.length !== 1) {
      return usageResult(['publish requires exactly one <file> argument']);
    }
    const filePath = resolveDocumentPath(paths, positional[0]);
    const report = await runPublish({ filePath, paths });
    return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
  }

  if (subcommand === 'list-cards') {
    if (positional.length !== 0) return usageResult(['list-cards takes no positional arguments']);
    let olderThanDays = null;
    if (flags['older-than'] !== undefined) {
      const m = /^(\d+)d$/.exec(String(flags['older-than']));
      if (!m) return usageResult(['--older-than must look like 30d']);
      olderThanDays = Number.parseInt(m[1], 10);
    }
    const report = await runListCards({
      status: flags.status !== undefined ? String(flags.status) : null,
      olderThanDays,
      paths,
    });
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

  if (subcommand === 'reprint') {
    if (positional.length !== 1) {
      return usageResult(['reprint requires exactly one <instanceId> argument']);
    }
    let outValue;
    try {
      outValue = valueFlag(flags.out, '--out');
    } catch (error) {
      return usageResult([error.message]);
    }
    if (outValue === undefined) return usageResult(['--out needs a path']);
    const outPath = path.isAbsolute(outValue) ? path.resolve(outValue) : path.resolve(process.cwd(), outValue);
    const report = await runReprint({ instanceId: positional[0], outPath, paths });
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

  const filePath = resolveDocumentPath(paths, positional[0]);
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
    (report.skipped ?? []).forEach((file) => lines.push(`  ${file}  SKIPPED (not a print document)`));
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

  if (report.mode === 'render' || report.mode === 'reprint') {
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

  if (report.mode === 'list-cards') {
    if (report.ok) {
      const lines = report.cards.map((c) => JSON.stringify(c));
      lines.push(`${report.cards.length} record${report.cards.length === 1 ? '' : 's'}`);
      return `${lines.join('\n')}\n`;
    }
    return `FAILED\n${report.errors.map((e) => `  - ${e}`).join('\n')}\n`;
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
