#!/usr/bin/env node
/**
 * Certify the published School content mount (catalog lessons + standalone
 * question banks) against every registered surface profile plus the TI-86
 * codec baseline — spec §8.
 *
 * A small composition root, mirroring `school.mjs calc`: mounted
 * YAML adapters and the calculator codec are wired here while every
 * certification rule stays in the School domain/application layers
 * (`GetSurfaceCertification`, `SurfaceRegistry`, the per-family ports).
 *
 * Two modes:
 *  - Gate mode (no --surface/--address/--file): run the full corpus
 *    validation pass (schema + references + asset existence) first — any
 *    error aborts with nothing certified (exit 1). A clean corpus is then
 *    certified in full: every catalog lesson and every standalone question
 *    bank against every static profile plus the codec baseline. Verdicts
 *    never fail the gate; a lesson/bank certified nowhere is a warning, not
 *    an error (exit 0). `--write-manifest` persists Task 11's manifest.
 *  - Query mode (--surface / --address / --file present): certifies only the
 *    requested scope. Exit 0 whenever certification ran — a `none` verdict
 *    is an answer, not a failure. Exit 1 only when the requested scope
 *    itself has a schema/reference error (e.g. an unresolvable address).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSchoolCalcContentPaths,
} from './calc.mjs';
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
  YamlSurfaceProfileRepository,
} from '#adapters/school/catalog/index.mjs';
import { PaperCertification } from '#adapters/school/paper/PaperCertification.mjs';
import { ScreenCertification } from '#adapters/school/screen/ScreenCertification.mjs';
import { Ti86SchoolCalcCodec } from '#adapters/schoolcalc/ti86/index.mjs';
import {
  Ti86SurfaceCertification, ti86CodecBaselineProfile,
} from '#adapters/schoolcalc/ti86/Ti86SurfaceCertification.mjs';
import { GetSurfaceCertification } from '#apps/school/surfaces/GetSurfaceCertification.mjs';
import { SurfaceRegistry } from '#apps/school/surfaces/SurfaceRegistry.mjs';
import { sortKeys, writeManifest } from '#apps/school/surfaces/certificationManifest.mjs';
import {
  listCatalogLessons, validateLearningCatalog,
} from '#domains/school/catalog/index.mjs';
import { isRegisteredCapability } from '#domains/school/surfaces/index.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

const EXIT_OK = 0;
const EXIT_FAIL = 1;
const EXIT_USAGE = 2;
const ENTRYPOINT = fileURLToPath(import.meta.url);
const BANK_ADDRESS_PREFIX = 'bank:';

const VALUE_FLAGS = new Set([
  'data-dir',
  'content-root',
  'catalog-directories',
  'document-directories',
  'question-bank-directories',
  'surfaces-directory',
  'assets-directory',
  'surface',
  'address',
  'file',
]);
const BOOLEAN_FLAGS = new Set(['json', 'write-manifest', 'strict-concepts']);
const ALLOWED_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);

const HELP = `school-certify — certify published School content against registered surface profiles

Usage:
  school.mjs certify [options]

Options:
  --data-dir <path>                  data root (default: $DAYLIGHT_BASE_PATH/data)
  --content-root <path>              content root, absolute or data-relative
                                     (default: content/school/learning-catalog)
  --catalog-directories <a,b>        override Catalog mount directories
  --document-directories <a,b>       override learning-document mount directories
  --question-bank-directories <a,b>  override question-bank mount directories
  --surfaces-directory <path>        override surface-profile directory
                                     (default: household/school/surfaces)
  --assets-directory <path>          override asset directory (default: <content-root>/assets)
  --surface <id>                     restrict to one surface/baseline id (repeatable, query mode)
  --address <addr>                   certify one lesson (a/b/c/d/e) or bank (bank:<id>) address (query mode)
  --file <path>                      certify one catalog or question-bank file (query mode)
  --json                             emit certification rows as sorted, byte-stable JSON lines
  --write-manifest                   write the certification manifest to <content-root>/certification-manifest.json
                                     (gate mode only — usage error otherwise)
  --strict-concepts                  fail on a bank concept id absent from the concept registry
                                     (<data-dir>/content/school/concepts.yml) instead of warning
  --help, -h                         show this message

Directory lists are comma-separated; relative entries resolve under --data-dir.
Gate mode (no --surface/--address/--file): exit 1 on any corpus validation error, nothing certified.
Query mode: exit 0 whenever certification ran; exit 1 only for schema/reference errors in scope.

Exit codes: 0 ok (including gate mode's "certified nowhere" warnings), 1 certification/validation
failure, 2 usage error (bad flags, e.g. --write-manifest outside gate mode or --surface with no value).
`;

/** Tiny argv scan: like `_argv.mjs` but supports a repeatable `--surface`. */
function parseCertifyArgv(argv) {
  const flags = {};
  const surfaces = [];
  const unknown = [];
  const usageErrors = [];
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') { help = true; continue; }
    if (!tok.startsWith('--')) { unknown.push(tok); continue; }
    const key = tok.slice(2);
    if (!ALLOWED_FLAGS.has(key)) { unknown.push(key); continue; }
    let value = true;
    if (VALUE_FLAGS.has(key)) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { value = next; i += 1; }
    }
    if (key === 'surface') {
      // A bare `--surface` (no value, or immediately followed by another
      // flag) leaves `value` as the boolean `true` sentinel above; pushing
      // that into `surfaces` used to surface as a baffling "unknown surface
      // 'true'" instead of a usage error (F13, 2026-08-04 acceptance audit).
      if (value === true) { usageErrors.push('--surface needs a value'); continue; }
      surfaces.push(value);
      continue;
    }
    flags[key] = value;
  }
  return {
    flags, surfaces, unknown, usageErrors, help,
  };
}

function valueFlag(value, name) {
  if (value === undefined) return undefined;
  if (value === true || typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

function resolveOptionalDirectory(value, fallback, dataDir, name) {
  const resolved = valueFlag(value, name);
  if (resolved === undefined) return fallback;
  return path.isAbsolute(resolved) ? path.resolve(resolved) : path.resolve(dataDir, resolved);
}

export function resolveCertifyPaths({ flags = {}, env = process.env } = {}) {
  const base = resolveSchoolCalcContentPaths({ flags, env });
  // Surface profiles declare what a rendering TARGET can do (channels, item
  // caps, capabilities) — device configuration, not coursework — so they live
  // under household config rather than on the authored content mount.
  // The grouped path (household/school/surfaces) is the only location — Phase E
  // deleted the retiring flat config/ fallback.
  const defaultSurfaces = path.join(base.dataDir, 'household/school/surfaces');
  const surfacesDirectory = resolveOptionalDirectory(
    flags['surfaces-directory'], defaultSurfaces, base.dataDir, 'surfaces-directory',
  );
  const assetsDirectory = resolveOptionalDirectory(
    flags['assets-directory'], path.join(base.contentRoot, 'assets'), base.dataDir, 'assets-directory',
  );
  return {
    ...base,
    surfacesDirectory,
    assetsDirectory,
    manifestPath: path.join(base.contentRoot, 'certification-manifest.json'),
  };
}

/** Sort rows so `--json` output (and the printed table) is byte-stable across runs. */
function sortRows(rows) {
  return [...rows].sort((a, b) => (
    a.address === b.address ? a.surfaceId.localeCompare(b.surfaceId) : a.address.localeCompare(b.address)
  ));
}

/** A row is "certified" when it offers something a learner/printer/device could use. */
function isCertified(row) {
  return row.moduleVerdicts === null ? row.verdict === 'render' : row.verdict !== 'none';
}

function certifiedNowhereWarnings(rows) {
  const byAddress = new Map();
  rows.forEach((row) => {
    if (!byAddress.has(row.address)) byAddress.set(row.address, []);
    byAddress.get(row.address).push(row);
  });
  const warnings = [];
  byAddress.forEach((addressRows, address) => {
    if (!addressRows.some(isCertified)) warnings.push(`${address}: certified on no registered surface`);
  });
  return warnings.sort();
}

function flattenValidationErrors({ catalogErrors, lessonErrors }) {
  const out = [];
  Object.keys(catalogErrors).sort().forEach((id) => {
    catalogErrors[id].forEach((message) => out.push(`catalog '${id}': ${message}`));
  });
  Object.keys(lessonErrors).sort().forEach((id) => {
    lessonErrors[id].forEach((message) => out.push(`lesson '${id}': ${message}`));
  });
  return out;
}

/** Every filename (any extension) under `assetsDirectory`, keyed by its path without extension. */
function collectAssetKeys(assetsDirectory) {
  const keys = new Set();
  const walk = (dir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.forEach((entry) => {
      if (entry.name.startsWith('.')) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else keys.add(rel.replace(/\.[^./]+$/, ''));
    });
  };
  walk(assetsDirectory, '');
  return keys;
}

/**
 * Every non-empty string value in an `isImageSpec` mapping
 * (`questionBankValidation.mjs`: "a mapping of non-empty strings", no fixed
 * key names — authors may key by resolution/theme/whatever) is itself an
 * asset reference. There is no single "the" reference field in a spec of
 * unconstrained shape, so every value is checked.
 */
function collectImageSpecRefs(imageSpec, label) {
  if (!imageSpec || typeof imageSpec !== 'object' || Array.isArray(imageSpec)) return [];
  return Object.entries(imageSpec)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([key, value]) => ({ ref: value, label: `${label}.${key}` }));
}

/**
 * Every asset/image reference one question-bank item can carry: `asset`
 * (`region_click`'s bare string ref) plus `promptImage`/`choices[].image`
 * (`asset_choice`'s image specs, spec §5.5 item 2 / questionBankValidation.mjs:141-156).
 */
function collectItemAssetRefs(item) {
  const refs = [];
  if (typeof item?.asset === 'string' && item.asset.length > 0) {
    refs.push({ ref: item.asset, label: 'asset' });
  }
  refs.push(...collectImageSpecRefs(item?.promptImage, 'promptImage'));
  if (Array.isArray(item?.choices)) {
    item.choices.forEach((choice, index) => {
      refs.push(...collectImageSpecRefs(choice?.image, `choices[${index}].image`));
    });
  }
  return refs;
}

/**
 * Asset-existence validation (spec §5.5.2): every document `asset` block's
 * `assetId` and every bank item's asset/image reference (`asset`,
 * `promptImage`, `choices[].image`) must resolve to a real file under
 * `<contentRoot>/assets/`. Walks the mounted directories directly (not
 * through catalog references) so a stray unreferenced document/bank with a
 * dangling ref is still caught.
 */
function validateAssetReferences({ documentDirectories, bankDirectories, assetsDirectory }) {
  const assetKeys = collectAssetKeys(assetsDirectory);
  const errors = [];
  documentDirectories.forEach((directory) => {
    [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
      const document = loadYaml(path.join(directory, relative));
      if (!document || !Array.isArray(document.blocks)) return;
      document.blocks.forEach((block) => {
        if (block?.type !== 'asset') return;
        if (!assetKeys.has(block.assetId)) {
          errors.push(`document '${document.documentId ?? relative}': asset block '${block.blockId ?? '?'}' references missing asset '${block.assetId}'`);
        }
      });
    });
  });
  bankDirectories.forEach((directory) => {
    [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
      const bank = loadYaml(path.join(directory, relative));
      if (!bank || !Array.isArray(bank.items)) return;
      bank.items.forEach((item) => {
        collectItemAssetRefs(item).forEach(({ ref, label }) => {
          if (!assetKeys.has(ref)) {
            errors.push(`question bank '${bank.id ?? relative}': item '${item.id ?? '?'}' ${label} references missing asset '${ref}'`);
          }
        });
      });
    });
  });
  return errors;
}

/**
 * Every declared lesson `requiredCapabilities` ID must be a real, registered
 * capability (spec §3 / §7.1) — either one of `KNOWN_CAPABILITY_IDS` or a
 * custom capability contributed by the module registry (same list handed to
 * `YamlSurfaceProfileRepository` for profile validation). A
 * pattern-valid-but-unregistered ID (a typo, or a capability that was never
 * wired up on any port) would otherwise pass publication silently and only
 * ever surface later as a quiet "certified nowhere" warning; treated here as
 * a hard reference error alongside asset-existence checks (F7, 2026-08-04
 * acceptance audit).
 */
async function validateRequiredCapabilityReferences({ catalogs, customCapabilities }) {
  const errors = [];
  const summaries = await catalogs.listCatalogs();
  // eslint-disable-next-line no-restricted-syntax
  for (const { catalogId } of summaries) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await catalogs.getCatalog(catalogId);
    const { catalog, errors: catalogErrors } = validateLearningCatalog(raw);
    if (catalogErrors.length) continue; // caught by the schema validation pass already
    listCatalogLessons(catalog).forEach(({ address, lesson }) => {
      (lesson.requiredCapabilities ?? []).forEach((id) => {
        if (!isRegisteredCapability(id, { customCapabilities })) {
          errors.push(`lesson '${address}': requiredCapabilities references unregistered capability '${id}'`);
        }
      });
    });
  }
  return errors;
}

/**
 * Concept-id lint (Task 10, concept registry + mastery facet). Every
 * bank-scoped concept a bank NAMES (`bank.concepts[].conceptId` —
 * questionBankValidation.mjs's declared vocabulary its items bind against,
 * NOT the household-wide registry) should resolve to a real, labeled entry
 * in the household concept registry (`<data-dir>/content/school/concepts.yml`,
 * `{concepts: [{id, label, parent?}]}`). The registry backs Task 10's
 * report-card `concepts` facet — it is a labeling/reporting aid, not a
 * publication gate, so an unresolved id is a WARNING by default and only
 * escalates to a hard error under `--strict-concepts`. The registry itself
 * is opt-in: most household mounts will never author one, so its total
 * absence earns one informational notice rather than a warning for every
 * bank that happens to declare concepts.
 */
function collectBankConceptRefs(bankDirectories) {
  const refs = [];
  bankDirectories.forEach((directory) => {
    [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
      const bank = loadYaml(path.join(directory, relative));
      if (!bank || !Array.isArray(bank.concepts)) return;
      bank.concepts.forEach((concept) => {
        if (concept && typeof concept.conceptId === 'string' && concept.conceptId) {
          refs.push({ conceptId: concept.conceptId, bankId: bank.id ?? relative });
        }
      });
    });
  });
  return refs;
}

function evaluateConceptRegistry({ dataDir, bankDirectories }) {
  const registryPath = path.join(dataDir, 'content', 'school', 'concepts');
  const raw = loadYaml(registryPath);
  if (raw === null) {
    return {
      notices: ['concept registry not found at content/school/concepts.yml — concept-id lint skipped'],
      unresolved: [],
    };
  }
  const known = new Set(
    Array.isArray(raw?.concepts)
      ? raw.concepts.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id)
      : [],
  );
  const unresolved = collectBankConceptRefs(bankDirectories).filter((ref) => !known.has(ref.conceptId));
  return { notices: [], unresolved };
}

function conceptReferenceMessages(unresolved) {
  return unresolved.map(({ conceptId, bankId }) => (
    `question bank '${bankId}': concept '${conceptId}' is not in the concept registry (content/school/concepts.yml)`
  )).sort();
}

function buildCorpus(paths) {
  const catalogs = new YamlLearningCatalogRepository({ directories: paths.catalogDirectories });
  const content = new YamlLearningContentRepository({
    documentDirectories: paths.documentDirectories,
    bankDirectories: paths.bankDirectories,
  });
  const moduleRegistry = createCoreLearningModuleRegistry();
  const buildLesson = new BuildLearningLesson({ catalogs, content, modules: moduleRegistry });
  const banks = { getBank: (bankId) => content.getQuestionBank(bankId) };
  return {
    catalogs, content, moduleRegistry, buildLesson, banks,
  };
}

async function buildRegistry({ surfacesDirectory, moduleRegistry }) {
  const profileRepository = new YamlSurfaceProfileRepository({
    directory: surfacesDirectory,
    customCapabilities: moduleRegistry.list().map((definition) => definition.capability),
  });
  const entries = await profileRepository.listProfiles();
  const profileErrors = entries
    .filter((entry) => !entry.profile)
    .map((entry) => `surface profile '${entry.file}': ${entry.errors.join('; ')}`);
  const registry = new SurfaceRegistry({
    profiles: entries,
    ports: {
      schoolcalc: new Ti86SurfaceCertification({ codec: new Ti86SchoolCalcCodec() }),
      paper: new PaperCertification(),
      screen: new ScreenCertification(),
    },
    baselines: [{ profile: ti86CodecBaselineProfile(), baseline: 'codec' }],
  });
  return { registry, profileErrors };
}

async function listAllLessonAddresses(catalogs) {
  const summaries = await catalogs.listCatalogs();
  const addresses = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const { catalogId } of summaries) {
    // eslint-disable-next-line no-await-in-loop
    const raw = await catalogs.getCatalog(catalogId);
    const { catalog, errors } = validateLearningCatalog(raw);
    if (errors.length) continue; // caught by the validation pass already; gate mode never reaches here with errors
    listCatalogLessons(catalog).forEach(({ address }) => addresses.push(address));
  }
  return addresses.sort();
}

function listAllBankIds(bankDirectories) {
  const ids = new Set();
  bankDirectories.forEach((directory) => {
    [...listYamlFiles(directory, { recursive: true })].sort().forEach((relative) => {
      const bank = loadYaml(path.join(directory, relative));
      if (bank && typeof bank.id === 'string' && bank.id) ids.add(bank.id);
    });
  });
  return [...ids].sort();
}

async function certifyTargets(certification, targets) {
  const rows = [];
  const errors = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const target of targets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const targetRows = target.type === 'bank'
        ? await certification.bank(target.id)
        : await certification.lesson(target.address);
      rows.push(...targetRows);
    } catch (error) {
      const label = target.type === 'bank' ? `bank '${target.id}'` : `lesson '${target.address}'`;
      errors.push(`${label}: ${error.message}`);
    }
  }
  return { rows, errors };
}

/**
 * Schema + reference + asset-existence errors for the WHOLE corpus (spec
 * §5.5.2). Shared by gate mode (always the whole corpus) and query mode's
 * no-`--address`/no-`--file` form — in that form the requested "scope" (per
 * the query-mode contract: "exit 1 only for schema/reference errors in
 * scope") IS the whole corpus, so it must be validated exactly like gate
 * mode before any of it is certified; a malformed catalog must not be
 * silently skipped and reported as "certification ran, verdicts are the
 * answer" for the rest. Also runs Task 10's concept-id lint.
 *
 * @param {{corpus: object, paths: object, strictConcepts?: boolean}} args
 * @returns {Promise<{errors: string[], conceptWarnings: string[], conceptNotices: string[]}>}
 *   `errors` is the historical flat "abort, certify nothing" list (schema +
 *   reference + asset-existence, now also concept-id references when
 *   `strictConcepts`). `conceptWarnings`/`conceptNotices` are Task 10's
 *   softer concept-registry surfaces — non-strict unresolved concept ids and
 *   the "no registry at all" notice — left for the caller to attach to a
 *   report's `warnings`/`notices` (gate mode does; query mode's whole-corpus
 *   validation reuses only `errors`, matching the existing "no query-mode
 *   warnings" scope of `certifiedNowhereWarnings`).
 */
async function validateCorpusScope({ corpus, paths, strictConcepts = false }) {
  const validation = await new ValidateSchoolCalcPublication({
    catalogs: corpus.catalogs, bundles: corpus.buildLesson,
  }).execute();
  const assetErrors = validateAssetReferences({
    documentDirectories: paths.documentDirectories,
    bankDirectories: paths.bankDirectories,
    assetsDirectory: paths.assetsDirectory,
  });
  const capabilityErrors = await validateRequiredCapabilityReferences({
    catalogs: corpus.catalogs,
    customCapabilities: corpus.moduleRegistry.list().map((definition) => definition.capability),
  });
  const conceptRegistry = evaluateConceptRegistry({ dataDir: paths.dataDir, bankDirectories: paths.bankDirectories });
  const conceptMessages = conceptReferenceMessages(conceptRegistry.unresolved);
  const errors = [
    ...flattenValidationErrors(validation),
    ...assetErrors,
    ...capabilityErrors,
    ...(strictConcepts ? conceptMessages : []),
  ].sort();
  return {
    errors,
    conceptWarnings: strictConcepts ? [] : conceptMessages,
    conceptNotices: conceptRegistry.notices,
  };
}

function maybeWriteManifest({ flags, rows, manifestPath, fs: fsDep = fs }) {
  if (!flags['write-manifest']) return null;
  fsDep.mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeManifest({ rows, path: manifestPath, fs: fsDep });
  return manifestPath;
}

async function runGateMode({ paths, flags, deps }) {
  const corpus = buildCorpus(paths);
  const strictConcepts = Boolean(flags['strict-concepts']);
  const corpusValidation = await validateCorpusScope({ corpus, paths, strictConcepts });
  const { registry, profileErrors } = await buildRegistry({
    surfacesDirectory: paths.surfacesDirectory, moduleRegistry: corpus.moduleRegistry,
  });

  const errors = [...corpusValidation.errors, ...profileErrors].sort();
  if (errors.length) {
    return {
      ok: false, mode: 'gate', errors, warnings: [], notices: corpusValidation.conceptNotices, rows: [], manifestWritten: null,
    };
  }

  const certification = new GetSurfaceCertification({
    buildLesson: corpus.buildLesson, catalogs: corpus.catalogs, banks: corpus.banks, registry,
  });
  const lessonAddresses = await listAllLessonAddresses(corpus.catalogs);
  const bankIds = listAllBankIds(paths.bankDirectories);
  const targets = [
    ...lessonAddresses.map((address) => ({ type: 'lesson', address })),
    ...bankIds.map((id) => ({ type: 'bank', id })),
  ];
  const { rows, errors: certifyErrors } = await certifyTargets(certification, targets);
  // Gate mode has already validated every reference; a certify-time failure here
  // would be a programming error, not authored content — surface it, don't swallow it.
  if (certifyErrors.length) {
    return {
      ok: false, mode: 'gate', errors: certifyErrors, warnings: [], notices: corpusValidation.conceptNotices, rows: [], manifestWritten: null,
    };
  }

  const warnings = [...certifiedNowhereWarnings(rows), ...corpusValidation.conceptWarnings].sort();
  const sortedRows = sortRows(rows);
  const manifestWritten = maybeWriteManifest({
    flags, rows: sortedRows, manifestPath: paths.manifestPath, fs: deps.fs,
  });

  return {
    ok: true, mode: 'gate', errors: [], warnings, notices: corpusValidation.conceptNotices, rows: sortedRows, manifestWritten,
  };
}

/** Resolve query-mode targets from `--address` / `--file`, or the whole corpus when neither is given. */
async function resolveQueryTargets({ flags, corpus, paths }) {
  if (flags.address) {
    const address = flags.address;
    return {
      targets: [address.startsWith(BANK_ADDRESS_PREFIX)
        ? { type: 'bank', id: address.slice(BANK_ADDRESS_PREFIX.length) }
        : { type: 'lesson', address }],
      errors: [],
    };
  }
  if (flags.file) {
    let raw;
    try {
      raw = loadYaml(path.resolve(flags.file));
    } catch (error) {
      return { targets: [], errors: [`file '${flags.file}': ${error.message}`] };
    }
    if (!raw) return { targets: [], errors: [`file '${flags.file}': not found or empty`] };
    if (raw.schema === 'school.catalog/v1') {
      const { catalog, errors } = validateLearningCatalog(raw);
      if (errors.length) return { targets: [], errors: errors.map((message) => `file '${flags.file}': ${message}`) };
      return {
        targets: listCatalogLessons(catalog).map(({ address }) => ({ type: 'lesson', address })),
        errors: [],
      };
    }
    if (typeof raw.id === 'string' && raw.id && Array.isArray(raw.items)) {
      return { targets: [{ type: 'bank', id: raw.id }], errors: [] };
    }
    return { targets: [], errors: [`file '${flags.file}': not a certifiable catalog or question-bank file`] };
  }
  // No --address/--file: the requested scope IS the whole corpus, so it must
  // pass the same validation gate mode runs before anything is certified
  // (finding: this branch used to reuse listAllLessonAddresses's silent
  // continue-on-error, which is only safe when a prior pass already
  // validated — which, unlike gate mode, this path never did).
  const corpusValidation = await validateCorpusScope({ corpus, paths, strictConcepts: Boolean(flags['strict-concepts']) });
  if (corpusValidation.errors.length) return { targets: [], errors: corpusValidation.errors };

  const lessonAddresses = await listAllLessonAddresses(corpus.catalogs);
  const bankIds = listAllBankIds(paths.bankDirectories);
  return {
    targets: [
      ...lessonAddresses.map((address) => ({ type: 'lesson', address })),
      ...bankIds.map((id) => ({ type: 'bank', id })),
    ],
    errors: [],
  };
}

async function runQueryMode({ paths, flags, surfaces, deps }) {
  const corpus = buildCorpus(paths);
  const { registry: fullRegistry, profileErrors } = await buildRegistry({
    surfacesDirectory: paths.surfacesDirectory, moduleRegistry: corpus.moduleRegistry,
  });
  if (profileErrors.length) {
    return {
      ok: false, mode: 'query', errors: profileErrors, warnings: [], notices: [], rows: [], manifestWritten: null,
    };
  }

  let registry = fullRegistry;
  if (surfaces.length) {
    const knownIds = new Set([
      ...fullRegistry.list().map((profile) => profile.surfaceId),
      ...fullRegistry.codecBaselines().map(({ profile }) => profile.surfaceId),
    ]);
    const unknownSurfaces = surfaces.filter((id) => !knownIds.has(id));
    if (unknownSurfaces.length) {
      return {
        ok: false,
        mode: 'query',
        errors: unknownSurfaces.map((id) => `unknown surface '${id}'`),
        warnings: [],
        notices: [],
        rows: [],
        manifestWritten: null,
      };
    }
    registry = new SurfaceRegistry({
      profiles: fullRegistry.list().filter((profile) => surfaces.includes(profile.surfaceId)),
      ports: {
        schoolcalc: fullRegistry.portFor({ family: 'schoolcalc' }),
        paper: fullRegistry.portFor({ family: 'paper' }),
        screen: fullRegistry.portFor({ family: 'screen' }),
      },
      baselines: fullRegistry.codecBaselines().filter(({ profile }) => surfaces.includes(profile.surfaceId)),
    });
  }

  const certification = new GetSurfaceCertification({
    buildLesson: corpus.buildLesson, catalogs: corpus.catalogs, banks: corpus.banks, registry,
  });
  const { targets, errors: targetErrors } = await resolveQueryTargets({ flags, corpus, paths });
  const { rows, errors: certifyErrors } = await certifyTargets(certification, targets);
  const errors = [...targetErrors, ...certifyErrors].sort();
  const sortedRows = sortRows(rows);
  const manifestWritten = maybeWriteManifest({
    flags, rows: sortedRows, manifestPath: paths.manifestPath, fs: deps.fs,
  });

  return {
    ok: errors.length === 0, mode: 'query', errors, warnings: [], notices: [], rows: sortedRows, manifestWritten,
  };
}

/**
 * Certify a published School content mount (spec §8).
 *
 * @param {string[]} argv
 * @param {{env?: object, fs?: object}} [deps] - injectable for tests; `env`
 *   feeds `resolveCertifyPaths` (mirrors `resolveSchoolCalcContentPaths`),
 *   `fs` is threaded through manifest writes.
 * @returns {Promise<{exitCode: number, report: object}>}
 */
export async function runCertify(argv = [], deps = {}) {
  const {
    flags, surfaces, unknown, usageErrors, help,
  } = parseCertifyArgv(argv);
  if (help) {
    return {
      exitCode: EXIT_OK,
      report: {
        ok: true, mode: 'help', errors: [], warnings: [], notices: [], rows: [], manifestWritten: null,
      },
    };
  }
  if (unknown.length || usageErrors.length) {
    return {
      exitCode: EXIT_USAGE,
      report: {
        ok: false,
        mode: 'usage',
        errors: [...unknown.map((token) => `Unknown option: --${token}`), ...usageErrors],
        warnings: [],
        notices: [],
        rows: [],
        manifestWritten: null,
      },
    };
  }

  let paths;
  try {
    paths = resolveCertifyPaths({ flags, env: deps.env ?? process.env });
  } catch (error) {
    return {
      exitCode: EXIT_USAGE,
      report: {
        ok: false, mode: 'usage', errors: [error.message], warnings: [], notices: [], rows: [], manifestWritten: null,
      },
    };
  }

  const isQueryMode = surfaces.length > 0 || Boolean(flags.address) || Boolean(flags.file);
  // --write-manifest persists the FULL corpus manifest (gate mode's
  // certifyTargets covers every lesson/bank). Query mode certifies only the
  // requested scope, so honoring --write-manifest there would silently
  // clobber the full manifest with a partial one (F8, 2026-08-04 acceptance
  // audit). Reject before either mode runs — the manifest file must stay
  // untouched.
  if (isQueryMode && flags['write-manifest']) {
    return {
      exitCode: EXIT_USAGE,
      report: {
        ok: false,
        mode: 'usage',
        errors: ['--write-manifest is only valid in gate mode (no --surface/--address/--file present)'],
        warnings: [],
        notices: [],
        rows: [],
        manifestWritten: null,
      },
    };
  }

  const report = isQueryMode
    ? await runQueryMode({
      paths, flags, surfaces, deps,
    })
    : await runGateMode({ paths, flags, deps });

  return { exitCode: report.ok ? EXIT_OK : EXIT_FAIL, report };
}

export function formatCertifyReport(report, { json = false } = {}) {
  if (json) {
    // Route each row through the manifest's canonical (recursively
    // sorted-key) serializer so "--json ... sorted, byte-stable JSON lines"
    // is literally true per line, not just true of row *order* (F13,
    // 2026-08-04 acceptance audit).
    return report.rows.map((row) => `${JSON.stringify(sortKeys(row))}\n`).join('');
  }
  const lines = [`School certification (${report.mode} mode)`];
  if (report.errors.length) {
    lines.push('', 'Errors');
    report.errors.forEach((error) => lines.push(`  - ${error}`));
  }
  lines.push('', `Certified ${report.rows.length} row(s)`);
  report.rows.forEach((row) => {
    const label = row.baseline ? `${row.surfaceId} (${row.baseline})` : row.surfaceId;
    lines.push(`  ${row.address}  ${label}  ${row.verdict}`);
  });
  if (report.warnings.length) {
    lines.push('', 'Warnings');
    report.warnings.forEach((warning) => lines.push(`  - ${warning}`));
  }
  if (report.notices?.length) {
    lines.push('', 'Notices');
    report.notices.forEach((notice) => lines.push(`  - ${notice}`));
  }
  if (report.manifestWritten) lines.push('', `Manifest written to ${report.manifestWritten}`);
  lines.push('', report.ok ? 'OK' : 'FAILED');
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), io = process) {
  const { exitCode, report } = await runCertify(argv);
  if (report.mode === 'help') {
    io.stdout.write(HELP);
    return exitCode;
  }
  io.stdout.write(formatCertifyReport(report, { json: argv.includes('--json') }));
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
