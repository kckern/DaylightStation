/**
 * RenderPrintDocument — the v2 print pipeline assembled (spec §3 governing
 * idea 1, §7 fit orchestration). Validates either envelope generation, then:
 *
 *   - v1 (schema-less) documents delegate straight to the legacy renderer
 *     entry, UNCHANGED — same theme, same options shape, byte-identical to
 *     calling that renderer directly. v2 is additive, never a migration.
 *   - v2 documents run the fit loop `fit.mjs`'s own docs describe: measure at
 *     normal density always; measure again at compact ONLY when fit policy
 *     `one-page` needs the fallback (`flow`/`fill` never try compact — see
 *     `resolveFitPlan`); feed the measured attempt(s) to `resolveFitPlan`;
 *     render once, at the chosen density, with furniture (footer +
 *     continuation strip + archetype-driven gutter/duplex) and `growLastPage`
 *     threaded through.
 *
 * D1 NOTE: this file imports `1_rendering` directly, unlike the rest of
 * `3_applications` (which reaches rendering only through the `IDocumentRenderer`
 * port — see that port's own docstring). `fit.mjs`'s docstring names this use
 * case, explicitly, as the one place allowed to run rendering's measurement
 * loop: "the loop that actually RUNS measurement at each density ... is Task
 * 8's use case (3_applications), which is allowed to call rendering." Every
 * rendering dependency is still constructor-injectable (`renderer`, `measure`,
 * `layout`) so callers/tests can substitute fakes exactly like a port would
 * allow.
 */
import path from 'node:path';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { validateAnyDocument, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { DOCUMENT_SOURCE_SCHEMA, publishDocument } from '#domains/school/documents/documentSource.mjs';
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';
import { resolveFitPlan } from '#domains/school/documents/fit.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg as mathJaxTexToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/** Archetypes bound through a physical binder get the alternating gutter (spec §7 furniture). */
const DUPLEX_ARCHETYPES = new Set(['worksheet']);

/**
 * `banks` dependency for bank-select sugar (spec §6.2, Task 5): synchronous
 * `{getBank(id)}`, same shape `IssueDocument`/`PrintService`'s `bankReader`
 * already use elsewhere in this codebase — mirrored here rather than reused
 * because those two live in a different part of the School application (the
 * pre-Phase-B quiz/worksheet delivery path) with their own injection story.
 * Reads from `<dataDir>/content/school/catalog/question-banks` — the SAME
 * layout `schoolCatalog.mjs`'s composition wiring resolves (against the
 * process's own `DAYLIGHT_BASE_PATH`) and the same data-root convention
 * `school-docs.cli.mjs`'s `resolveSchoolDocsContentPaths` resolves against
 * `--data-dir`/`$DAYLIGHT_BASE_PATH`.
 *
 * EXPORTED (review finding F5) so a caller that has ALREADY resolved its own
 * `dataDir` — `school-docs.cli.mjs`'s `--data-dir` flag, in particular — can
 * root this reader there instead of silently falling back to
 * `defaultBankReader`'s own `$DAYLIGHT_BASE_PATH`/`/usr/src/app/data` guess,
 * which never sees a CLI-supplied override. `defaultBankReader` (this
 * constructor's own no-args default) is now a thin wrapper over this.
 *
 * Memoized (F5, "the ledger's no-cache minor"): the original implementation
 * re-walked and re-parsed EVERY yml file in the directory on every single
 * `getBank` call, including once per bank-select block in a document with
 * several. A `RenderPrintDocument` (and the reader it builds/is given) is
 * cheap to construct per render — see the constructor's own "cheap, so never
 * cached across calls" note on `renderer` — so caching for the reader's own
 * lifetime (one render, or one CLI invocation) is safe: nothing in this
 * process is expected to publish a NEW bank file mid-render.
 */
export function createYamlBankReader({ dataDir } = {}) {
  const resolvedDataDir = dataDir
    ?? (process.env.DAYLIGHT_BASE_PATH ? path.join(process.env.DAYLIGHT_BASE_PATH, 'data') : '/usr/src/app/data');
  const directory = path.resolve(resolvedDataDir, 'content/school/catalog/question-banks');
  let cache = null;

  function loadAll() {
    if (cache) return cache;
    cache = new Map();
    const files = [...listYamlFiles(directory, { recursive: true })].sort();
    for (const relative of files) {
      const raw = loadYaml(path.join(directory, relative));
      if (raw && typeof raw.id === 'string' && !cache.has(raw.id)) cache.set(raw.id, raw);
    }
    return cache;
  }

  return {
    getBank(bankId) {
      return loadAll().get(bankId) ?? null;
    },
  };
}

function defaultBankReader() {
  return createYamlBankReader();
}

/** Bank-item types a bank-select sugar block can expand into a printable `question` (see `#expandBankSelectSugar`). */
const BANK_SELECT_RENDERABLE_TYPES = new Set(['multiple_choice', 'multi_select', 'short_answer']);

/**
 * One selected bank item -> one concrete, numbered `question` block — the
 * exact node pair an author would hand-write inline (spec §6.1's "Kept;
 * extended with... the multi_select shape"): `omr_response.itemId` is set to
 * the bank item's own id, which is what `documentValidation.mjs`'s "omr_response
 * itemId must match its question itemId" rule already requires, and what
 * `DocumentPdfRenderer`'s `createChoiceResolver(bank)` looks up choice text by.
 * `short_answer` reuses the `short_answer` SUGAR block (not a hand-rolled
 * `answer_space`) so its own default-lines geometry stays the single source
 * of truth.
 */
function expandedQuestionBlock(item, { number, points }) {
  if (item.type === 'short_answer') {
    return {
      type: 'question', itemId: item.id, number, points, blocks: [{ type: 'short_answer', prompt: item.prompt }],
    };
  }
  return {
    type: 'question',
    itemId: item.id,
    number,
    points,
    blocks: [
      { type: 'rich_text', md: item.prompt },
      { type: 'omr_response', itemId: item.id, choices: item.choices.length },
    ],
  };
}

/**
 * `wordbank`/`matching` orders are shuffled by their `key` BEFORE measurement
 * (spec §6.2) — terms/left/right print in seeded order, never document order.
 * Recurses only where these two block types can legally occur: document top
 * level, or one level inside a `question`'s own `blocks[]` (both `inset` and
 * `question` itself reject nesting a `question`, and `inset` separately bans
 * `wordbank`/`matching`/`cloze` outright — see `blocks.mjs`'s
 * `INSET_UNSUPPORTED_CHILD_TYPES` — so `inset.blocks[]` is walked here only
 * for completeness/forward-safety, never actually finding either type).
 *
 * `matching`'s two lists are shuffled INDEPENDENTLY (spec §6.2's "two
 * seeded-shuffled lists") — one derived permutation per side, from the SAME
 * `key` but a distinct hash input (`deriveShuffle`'s `key` argument is a
 * plain PRNG-seed string, not re-validated against `SHUFFLE_KEY_PATTERN`, so
 * a suffix here is safe even though an AUTHORED key could never contain
 * one). The derived bank's `pairs` (canonical left/right correspondence) are
 * never touched — only the PRINTED presentation order changes.
 */
function shuffleAssessmentBlocks(blocks, seed, variant) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'wordbank' && Array.isArray(block.terms)) {
      const permutation = deriveShuffle(seed, variant, block.key, block.terms.length);
      return { ...block, terms: applyShuffle(block.terms, permutation) };
    }
    if (block.type === 'matching' && Array.isArray(block.left) && Array.isArray(block.right)) {
      const leftPermutation = deriveShuffle(seed, variant, `${block.key}:left`, block.left.length);
      const rightPermutation = deriveShuffle(seed, variant, `${block.key}:right`, block.right.length);
      return {
        ...block,
        left: applyShuffle(block.left, leftPermutation),
        right: applyShuffle(block.right, rightPermutation),
      };
    }
    if ((block.type === 'question' || block.type === 'inset') && Array.isArray(block.blocks)) {
      return { ...block, blocks: shuffleAssessmentBlocks(block.blocks, seed, variant) };
    }
    return block;
  });
}

/**
 * `totalPoints` (spec §13): sum of every scored (`question`) block's
 * `points ?? defaultPoints`, INCLUDING bank-selected questions — safe to scan
 * only top-level blocks because a `question` can never nest (inside another
 * `question` or an `inset`, both banned by `blocks.mjs`) and, by the time
 * this runs, `#expandBankSelectSugar` has already replaced every bank-select
 * sugar block with concrete numbered `question` blocks — there is no
 * remaining `select` branch to special-case.
 */
function sumScoredPoints(blocks, defaultPoints) {
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((total, block) => (
    block?.type === 'question'
      ? total + (typeof block.points === 'number' ? block.points : defaultPoints)
      : total
  ), 0);
}

/** Merges the document's own derived bank (if any) with bank-select-resolved items into ONE `{id, items}` bank, or null if there is nothing at all. */
function mergeBank(baseBank, extraItems, documentId) {
  const items = [...(baseBank?.items ?? []), ...extraItems];
  if (items.length === 0) return null;
  return { id: baseBank?.id ?? documentId, items };
}

// ── teacher key (spec §4.1, §12.1, Task 6) ─────────────────────────────────
//
// The teacher key is a RENDER MODE (`context.teacher: true`), never a
// variant: it prints the exact same student pages, then a `page_break` and a
// dense answer list. Every answer comes ONLY from the merged bank
// (`mergeBank`'s output, already assembled above from the SAME derived/
// bank-select items the student render used) — never re-derived, never read
// off `rawDocument` (which the publish pipeline guarantees is answer-free
// anyway). The formatted `{label, text}` entries this section builds are
// handed to the renderer as a private `answer_key` node
// (`measure.mjs`/`DocumentPdfRenderer.mjs`) that is not part of the
// authorable block vocabulary (`blocks.mjs`'s BLOCK_TYPES) — it only ever
// exists on this in-memory path, so it needs no schema/validator of its own.

/** `theme.omr.letters[index]` — the SAME glyph a multiple_choice/multi_select bubble row prints for that choice position (spec §5.1's Ⓐ–Ⓔ contract), so the key's letters can never disagree with what a card bubbles. */
function choiceLetter(letters, choices, value) {
  const index = choices.indexOf(value);
  return index === -1 ? '?' : letters[index];
}

const PROMPT_LABEL_MAX_LENGTH = 40;

/**
 * A standalone `short_answer` sugar block (spec §4.2/§6.2) has no `.number`
 * of its own — it's a write-on aside, never card-mapped — and the SAME text
 * this trims from prints verbatim, unnumbered, on the student page itself
 * (`measure.mjs`'s `short_answer` case: prompt text + a bare `answer_space`,
 * desugared directly, no numbering). So the only thing on the printed page a
 * teacher can actually match a key entry against is that prompt text — never
 * the bank item's internal path-based id (`blocks-0`, `blocks[2].blocks[0]`
 * — `documentSource.mjs`'s keyless-item id scheme), which appears nowhere on
 * paper. Truncated to `PROMPT_LABEL_MAX_LENGTH` so a long prompt doesn't
 * blow out the dense key's one-line-per-entry layout.
 */
function truncatePrompt(prompt) {
  const text = String(prompt ?? '').trim();
  return text.length > PROMPT_LABEL_MAX_LENGTH ? `${text.slice(0, PROMPT_LABEL_MAX_LENGTH - 1)}…` : text;
}

/**
 * One bank item's answer text (spec §12.1's teacher-key acceptance:
 * "matching -> 1-C 2-A style; multi_select -> sorted letters; cloze blanks ->
 * <n>. <answer>; short_answer -> the answer text"). `matching` is handled
 * separately (`formatMatchingAnswer`) — it needs the printed left/right
 * ORDER, not just the item itself. `multiple_choice` (not named in that
 * list, since it predates Phase B) gets the same single-letter treatment as
 * `multi_select`'s set, just one letter instead of several.
 */
function formatAnswer(item, letters) {
  switch (item.type) {
    case 'multiple_choice':
      return choiceLetter(letters, item.choices, item.answer);
    case 'multi_select':
      return [...item.answers].map((answer) => choiceLetter(letters, item.choices, answer)).sort().join(', ');
    case 'short_answer':
    case 'cloze':
      return item.answer;
    default:
      return String(item.answer ?? '');
  }
}

/**
 * A `matching` block's whole answer, as `"1-C 2-A 3-B"` (spec §12.1):
 * `item.pairs` are TEXT pairs resolved at publish time from the block's
 * document-order `left`/`right` (spec §4.3 — the derived bank holds the
 * canonical correspondence; only PRINTED order shuffles). `block.left`/
 * `block.right` here are the SAME (already shuffled, `#prepareV2Document`)
 * arrays the student's printed page numbers/letters against
 * (`measure.mjs`'s `measureMatchingNode`: left numbered 1..n by array
 * position, right lettered A..n by array position) — resolving against THEM,
 * not the bank's own order, is what keeps "1-C" in lockstep with what the
 * student actually sees on the page.
 */
function formatMatchingAnswer(block, item, letters) {
  return item.pairs
    .map((pair) => ({
      number: block.left.indexOf(pair.left) + 1,
      letter: letters[block.right.indexOf(pair.right)],
    }))
    .sort((a, b) => a.number - b.number)
    .map(({ number, letter }) => `${number}-${letter}`)
    .join(' ');
}

// ── teacher-key LABEL NAMESPACES (review finding F1) ────────────────────────
//
// Three label domains share one dense list, so they must never collide:
//   - `question` entries: bare `N.` — the SAME number the student page prints
//     next to the question (card-row identity, spec §5.3).
//   - `matching` entries: `Matching:` (or `Matching <ordinal>:` when the
//     document has more than one matching block) — NEVER the internal
//     `block.key`, which is authoring plumbing that prints nowhere on the
//     student page and gives a teacher nothing to correlate against.
//   - `cloze` entries: grouped under a `Fill-in (passage <ordinal>):` heading
//     (one per cloze block, in document order), then one `blank <n>:` line
//     per blank underneath it. `<n>` matches the small raised digit
//     `drawClozeBlank` (DocumentPdfRenderer.mjs) prints at the blank's start
//     on the student page — so "blank 2" in the key IS the "2" the student
//     sees. Deliberately a PLAIN digit label (`blank 2:`), not a literal
//     Unicode superscript glyph: the student page's "superscript" is a raised
//     SMALL regular digit (a y-offset + smaller font size), never a distinct
//     code point, and the embedded OFL workbook font's glyph coverage for
//     U+00B9/U+2070-2079 is unverified — spending that risk on a cosmetic
//     flourish in a plain-text list buys nothing a teacher needs.
// Grouping cloze answers under a per-block heading (rather than the bare
// `blank.n` label the old code used, which reset to 1 at the start of EVERY
// cloze block) is what stops a second cloze block's blanks from colliding
// with the first's — see the kitchen-sink fixture's second cloze block.
const NO_MATCHING_ORDINAL = 1;

/** How many `matching` entries the answer key WILL emit — decides whether `Matching:` needs an ordinal suffix (F1: "Matching <ordinal>: when several"). */
function countMatchingEntries(blocks, bankItemsById) {
  let count = 0;
  for (const block of blocks ?? []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'matching' && typeof block.itemRef === 'string' && bankItemsById.has(block.itemRef)) {
      count += 1;
    } else if ((block.type === 'question' || block.type === 'inset') && Array.isArray(block.blocks)) {
      count += countMatchingEntries(block.blocks, bankItemsById);
    }
  }
  return count;
}

/**
 * Walks the SAME prepared `blocks` the student render draws (post-shuffle,
 * post-bank-select-expansion — `#prepareV2Document`'s output), collecting one
 * `{label, text}` key entry per answerable item found. Recurses into
 * `question`/`inset` children (the only two block types that can nest — see
 * `blocks.mjs`), so an assessment block sitting one level inside either is
 * still found.
 *
 * `counters` (F1) is a single mutable object threaded through every
 * recursive call so ordinals ("passage 2", "Matching 2") stay correct in
 * DOCUMENT order regardless of nesting depth — it is built once, from the
 * FULL top-level `blocks` tree, by the outer (non-recursive) call.
 *
 * A `question` whose OWN `itemId` resolves in the bank is the common,
 * card-mappable case (multiple_choice/multi_select/short-answer-as-question,
 * both hand-authored and bank-select-expanded — `expandedQuestionBlock`
 * always sets `itemId: item.id`) and gets its one entry pushed. Its
 * `blocks[]` is THEN ALSO always walked (F3, review finding): a question can
 * mint its own item AND wrap further answer-bearing children (e.g. a
 * composite question whose body embeds its own cloze) — the OLD code's
 * `else if` made these mutually exclusive, silently dropping the children's
 * entries whenever the question's own itemId also resolved.
 */
function collectAnswerKeyEntries(blocks, bankItemsById, letters, entries = [], counters = null) {
  const state = counters ?? { matchingSeen: 0, matchingTotal: countMatchingEntries(blocks, bankItemsById), clozeSeen: 0 };
  for (const block of blocks ?? []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'question') {
      const item = typeof block.itemId === 'string' ? bankItemsById.get(block.itemId) : undefined;
      if (item) entries.push({ label: `${block.number}.`, text: formatAnswer(item, letters) });
      if (Array.isArray(block.blocks)) {
        collectAnswerKeyEntries(block.blocks, bankItemsById, letters, entries, state);
      }
      continue;
    }
    if (block.type === 'inset' && Array.isArray(block.blocks)) {
      collectAnswerKeyEntries(block.blocks, bankItemsById, letters, entries, state);
      continue;
    }
    if (block.type === 'matching' && typeof block.itemRef === 'string') {
      const item = bankItemsById.get(block.itemRef);
      if (item) {
        state.matchingSeen += 1;
        const label = state.matchingTotal > NO_MATCHING_ORDINAL ? `Matching ${state.matchingSeen}:` : 'Matching:';
        entries.push({ label, text: formatMatchingAnswer(block, item, letters) });
      }
      continue;
    }
    if (block.type === 'cloze' && Array.isArray(block.blanks)) {
      const qualifying = block.blanks.filter(
        (blank) => typeof blank.itemRef === 'string' && bankItemsById.has(blank.itemRef),
      );
      if (qualifying.length) {
        state.clozeSeen += 1;
        entries.push({ label: `Fill-in (passage ${state.clozeSeen}):`, text: '' });
        for (const blank of qualifying) {
          const item = bankItemsById.get(blank.itemRef);
          entries.push({ label: `blank ${blank.n}:`, text: formatAnswer(item, letters) });
        }
      }
      continue;
    }
    if (block.type === 'short_answer' && typeof block.itemRef === 'string') {
      const item = bankItemsById.get(block.itemRef);
      // Label with the prompt text itself (see `truncatePrompt`'s doc
      // comment) — the item's own `id` is an internal path-based identity
      // (`blocks-0`) that never appears anywhere on the printed page, so it
      // gives a teacher nothing to correlate the key line against.
      if (item) entries.push({ label: `"${truncatePrompt(item.prompt)}" —`, text: formatAnswer(item, letters) });
    }
  }
  return entries;
}

/**
 * The teacher-key section's block list + heading, for `renderer.render`'s
 * `keyBlocks`/`keyTitle` options (DocumentPdfRenderer.mjs) — one `answer_key`
 * node built from the merged bank, never the published document itself
 * (spec: "Answers come ONLY from the derived bank object passed in-memory to
 * the key renderer"). Zero answerable items is legal (a purely presentational
 * worksheet, or a bank the caller failed to resolve) — it renders a bare
 * heading and a note, plus a caller-facing warning, rather than failing the
 * whole render.
 */
function buildTeacherKeyBlocks(document, bank, letters) {
  const bankItemsById = new Map((bank?.items ?? []).map((item) => [item.id, item]));
  const entries = collectAnswerKeyEntries(document.blocks, bankItemsById, letters);
  const title = `Answer key — ${document.title || document.id} (variant ${document.variant ?? 0})`;
  const blocks = [{
    type: 'answer_key',
    entries: entries.length ? entries : [{ label: '', text: 'No answerable items in this document.' }],
  }];
  const warning = entries.length
    ? null
    : `document '${document.id}' has no answerable items; the teacher key is a bare heading`;
  return { blocks, title, warning };
}

export class RenderPrintDocument {
  #repository; #rendererFactory; #createMeasurementDocument; #measureDocumentFragments;
  #placeFragments; #contentHeightPt; #texToSvg; #resolveAsset; #legacyRenderer; #banks;

  /**
   * @param {Object} [deps]
   * @param {{get: (id: string) => (object|Promise<object>), getDerivedBank?: Function}} [deps.repository] -
   *   resolves `execute({id})`; required only when `id` (not `document`) is used.
   *   `getDerivedBank(id, rev)` (Task 5), when present, resolves the derived
   *   bank behind a PUBLISHED (`rev`-carrying) v2 document.
   * @param {{getBank: (id: string) => (object|null)}} [deps.banks] - resolves a
   *   bank-select sugar block's `bankId` (spec §6.2, Task 5). Defaults to a YAML
   *   reader over the school content mount's question-banks directory (see
   *   `defaultBankReader`).
   * @param {Function} [deps.renderer] - `({theme?, texToSvg, resolveAsset, fontDir?}) => {render}`;
   *   defaults to `createDocumentPdfRenderer`. Called once per density (v2) or
   *   once for the legacy theme (v1) — cheap, so never cached across calls.
   * @param {{createMeasurementDocument: Function, measureDocumentFragments: Function}} [deps.measure]
   * @param {{placeFragments: Function, contentHeightPt: Function}} [deps.layout]
   * @param {Function} [deps.texToSvg] - TeX → SVG; defaults to the real MathJax renderer
   * @param {Function|null} [deps.resolveAsset] - (ref) => {svg, widthPt, heightPt}; default
   *   throws on any asset reference, matching `createDocumentPdfRenderer`'s own default
   */
  constructor({
    repository = null,
    banks = null,
    renderer = createDocumentPdfRenderer,
    measure = { createMeasurementDocument, measureDocumentFragments },
    layout = { placeFragments, contentHeightPt },
    texToSvg = mathJaxTexToSvg,
    resolveAsset = null,
  } = {}) {
    this.#repository = repository;
    this.#banks = banks ?? defaultBankReader();
    this.#rendererFactory = renderer;
    this.#createMeasurementDocument = measure.createMeasurementDocument;
    this.#measureDocumentFragments = measure.measureDocumentFragments;
    this.#placeFragments = layout.placeFragments;
    this.#contentHeightPt = layout.contentHeightPt;
    this.#texToSvg = texToSvg;
    this.#resolveAsset = resolveAsset;
    // The legacy (v1) render target: default theme, no furniture, no
    // growLastPage — literally what `createDocumentPdfRenderer(...)` already
    // meant before this use case existed.
    this.#legacyRenderer = this.#rendererFactory({ texToSvg: this.#texToSvg, resolveAsset: this.#resolveAsset });
  }

  /**
   * @param {Object} args
   * @param {Object} [args.document] - a raw (unvalidated) document, v1 or v2 envelope
   * @param {string} [args.id] - looked up via `repository` when `document` is not given
   * @param {{learnerName?: string, date?: string, gutter?: boolean|number, teacher?: boolean}} [args.context] -
   *   `learnerName`/`date` prefill the header's Name/Date lines (blank ruled lines
   *   when absent); `gutter` overrides the default 3-hole-punch reservation
   *   (v2 only — must be >= 0). `teacher` (v2 only, spec §4.1/§12.1) is a RENDER
   *   MODE, orthogonal to `seed`/`variant`: it prints the identical student
   *   pages this same call would have produced without it, then appends a
   *   dense answer-key section built from the resolved bank. Ignored on the
   *   v1 (legacy) path — v1 has no teacher-key concept.
   * @returns {Promise<{bytes: Buffer, pageCount: number, density: 'normal'|'compact'|null, warnings: string[]}>}
   *   `density` is null for a v1 (legacy-path) document, which has no density concept.
   */
  async execute({ document: rawDocument, id, context = {} } = {}) {
    const raw = rawDocument !== undefined ? rawDocument : (id !== undefined ? await this.#loadById(id) : undefined);
    if (raw === undefined) {
      throw new ValidationError('RenderPrintDocument.execute requires a document or an id', { code: 'MISSING_DOCUMENT' });
    }

    const { errors, document } = validateAnyDocument(raw);
    if (errors.length) {
      throw new ValidationError(`print document is invalid: ${errors.join('; ')}`, {
        code: 'INVALID_DOCUMENT', details: { errors },
      });
    }

    if (document.schema === DOCUMENT_SOURCE_SCHEMA) {
      // Source-schema inputs are auto-published IN MEMORY for a proof render
      // (spec §3) — nothing is persisted here; `PublishPrintDocument` is the
      // only path that writes published/derived-bank artifacts to disk.
      // `publishDocument` re-validates `raw` itself (it takes an unvalidated
      // source), so the `document` this branch already has (validated once,
      // above) is discarded in favor of publish's own postcondition-checked
      // output.
      const publishResult = publishDocument(raw);
      if (publishResult.errors) {
        throw new ValidationError(`print document is invalid: ${publishResult.errors.join('; ')}`, {
          code: 'INVALID_DOCUMENT', details: { errors: publishResult.errors },
        });
      }
      return this.#renderV2(publishResult.published, context, { bank: publishResult.bank });
    }

    if (document.schema === DOCUMENT_V2_SCHEMA) {
      const bank = await this.#resolvePublishedBank(document);
      return this.#renderV2(document, context, { bank });
    }

    return this.#renderLegacy(document, context);
  }

  async #loadById(id) {
    if (!this.#repository) {
      throw new ValidationError('RenderPrintDocument.execute({id}) requires a repository', { code: 'MISSING_REPOSITORY' });
    }
    const raw = await this.#repository.get(id);
    if (!raw) {
      throw new ValidationError(`no print document found for id '${id}'`, { code: 'DOCUMENT_NOT_FOUND', details: { id } });
    }
    return raw;
  }

  /**
   * A PUBLISHED v2 document (one that carries `rev`) resolves its derived
   * bank through the repository (spec §3/§4.3) — needed whenever the
   * document has an inline `multiple_choice`/`multi_select` question (its
   * `omr_response` choice text lives in the bank, never duplicated onto the
   * page) or will EVER be rendered as a teacher key (which reads answers off
   * the bank). A hand-authored v2 document with no `rev` was never published,
   * so there is nothing to look up — `bank` stays whatever bank-select sugar
   * resolution alone produces (`#renderV2`/`mergeBank`).
   */
  async #resolvePublishedBank(document) {
    if (typeof document.rev !== 'string' || !this.#repository
      || typeof this.#repository.getDerivedBank !== 'function') {
      return null;
    }
    const bank = await this.#repository.getDerivedBank(document.id, document.rev);
    return bank ?? null;
  }

  /** v1: the legacy render entry, untouched — same theme, same option shape. */
  async #renderLegacy(document, context) {
    const result = await this.#legacyRenderer.render(document, { studentName: context.learnerName ?? null });
    return {
      bytes: result.pdf, pageCount: result.pageCount, density: null, warnings: [],
    };
  }

  /**
   * Expands every bank-select sugar block (spec §6.2, Task 5) at document
   * TOP LEVEL — the only place a `question` can occur (`blocks.mjs` bans
   * nesting one inside another `question` or inside an `inset`) — into
   * concrete, numbered `question` blocks, and shuffles wordbank/matching
   * order. Returns the transformed document, the bank items the selections
   * resolved (for `mergeBank`), and any warnings (currently: a supplied but
   * unapplied bank-select `filter`).
   *
   * NUMBERING (task-5 review, finding 1): printed numbers are assigned
   * STRICTLY POSITIONALLY, walking `blocks` in document order, across BOTH
   * hand-authored questions and bank-select-expanded ones. A "keep the
   * author's own `number`, mint bank-select numbers from a running max"
   * scheme (the original implementation) prints bank-select items ahead of a
   * LATER-numbered-but-EARLIER-printed hand-authored question whenever a
   * bank-select block sits before one in the document — e.g. a bank-select
   * block first, a hand-authored `number: 1` question second, prints "2.
   * <bank item>" THEN "1. <hand-authored>", visibly out of order. Spec §5.3
   * treats printed numbers as future Phase C card-row identifiers, so
   * contiguous positional numbering is the one scheme that can't drift; an
   * author's own `number` field is authoring intent only — nothing else
   * (bank/grading lookups) reads it, those key off `itemId`.
   */
  #prepareV2Document(document) {
    const blocks = Array.isArray(document.blocks) ? document.blocks : [];

    let nextNumber = 1;
    const seenItemIds = new Set(blocks
      .filter((block) => block?.type === 'question' && block.select === undefined && typeof block.itemId === 'string')
      .map((block) => block.itemId));
    const extraItems = [];
    const warnings = [];

    const expandedBlocks = blocks.flatMap((block) => {
      if (!block || block.type !== 'question') return [block];

      if (block.select === undefined) {
        const number = nextNumber;
        nextNumber += 1;
        return [{ ...block, number }];
      }

      if (block.filter !== undefined) {
        // Finding 2 (task-5 review): a supplied-but-ignored option must warn,
        // never fail silently — this project has already been burned twice
        // by exactly that pattern. `filter` is validated upstream
        // (`blocks.mjs`) but not yet applied by this v1 picker; the spec
        // frames it as scaffolding for "the v2 adaptive hook", which
        // replaces the PICKER function, not the schema (spec §6.2).
        warnings.push(
          `bank-select question (key '${block.key}') supplies filter but it is not applied in Phase B; `
          + 'selection is unfiltered',
        );
      }

      const selected = this.#resolveBankSelect(block, document);
      return selected.map((item) => {
        if (!BANK_SELECT_RENDERABLE_TYPES.has(item.type)) {
          throw new ValidationError(
            `bank-select question (key '${block.key}') selected item '${item.id}' of type `
            + `'${item.type}', which has no print rendering yet`,
            {
              code: 'BANK_SELECT_UNSUPPORTED_ITEM_TYPE',
              details: {
                bankId: block.bankId, key: block.key, itemId: item.id, itemType: item.type,
              },
            },
          );
        }
        if (seenItemIds.has(item.id)) {
          throw new ValidationError(
            `bank-select question (key '${block.key}') selected item '${item.id}', which collides `
            + "with another question's itemId",
            { code: 'BANK_SELECT_ITEM_ID_COLLISION', details: { itemId: item.id } },
          );
        }
        seenItemIds.add(item.id);
        extraItems.push(item);
        const number = nextNumber;
        nextNumber += 1;
        return expandedQuestionBlock(item, { number, points: block.points ?? document.defaultPoints });
      });
    });

    const shuffledBlocks = shuffleAssessmentBlocks(expandedBlocks, document.seed, document.variant);
    return {
      document: { ...document, blocks: shuffledBlocks }, extraItems, warnings,
    };
  }

  /**
   * `{bankId, select, key, filter?}` -> the first `select` items of
   * `applyShuffle(bank.items, deriveShuffle(seed, variant, key, bank.items.length))`
   * (spec §6.2's exact resolution formula). `filter` itself is handled by the
   * caller (`#prepareV2Document`, which warns when it is present) — this
   * method only resolves the selection.
   */
  #resolveBankSelect(block, document) {
    const bank = this.#banks?.getBank ? this.#banks.getBank(block.bankId) : null;
    if (!bank || !Array.isArray(bank.items) || bank.items.length === 0) {
      throw new ValidationError(
        `bank-select question (key '${block.key}') references unknown or empty bank '${block.bankId}'`,
        { code: 'BANK_SELECT_BANK_NOT_FOUND', details: { bankId: block.bankId, key: block.key } },
      );
    }
    if (block.select > bank.items.length) {
      throw new ValidationError(
        `bank-select question (key '${block.key}') asked for ${block.select} items but bank `
        + `'${block.bankId}' has only ${bank.items.length}`,
        {
          code: 'BANK_SELECT_INSUFFICIENT_ITEMS',
          details: {
            bankId: block.bankId, key: block.key, available: bank.items.length, requested: block.select,
          },
        },
      );
    }
    const permutation = deriveShuffle(document.seed, document.variant, block.key, bank.items.length);
    return applyShuffle(bank.items, permutation).slice(0, block.select);
  }

  /** v2: fit loop, then one furniture-aware render at the chosen density. */
  async #renderV2(rawDocument, context, { bank: baseBank = null } = {}) {
    const { document, extraItems, warnings: prepareWarnings } = this.#prepareV2Document(rawDocument);
    const totalPoints = sumScoredPoints(document.blocks, document.defaultPoints);
    const bank = mergeBank(baseBank, extraItems, document.id);

    const gutter = this.#resolveGutter(context);
    const furnitureOpts = {
      gutter,
      duplex: DUPLEX_ARCHETYPES.has(document.archetype),
      title: document.title || document.id,
      nameLine: context.learnerName ?? null,
    };

    const normalTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'normal' });
    const normalAttempt = this.#measureAttempt(document, normalTheme, 'normal', context, furnitureOpts, totalPoints);

    const attempts = [normalAttempt];
    let compactTheme = null;
    // Measurement at compact density is run ONLY when `one-page` needs the
    // fallback (`fit.mjs`'s own contract) — `flow`/`fill` never try compact.
    if (document.fit.policy === 'one-page' && normalAttempt.pageCount !== 1) {
      compactTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'compact' });
      attempts.push(this.#measureAttempt(document, compactTheme, 'compact', context, furnitureOpts, totalPoints));
    }

    const plan = resolveFitPlan({ policy: document.fit.policy, attempts });
    if (plan.error) {
      throw new ValidationError(
        `document '${document.id}' does not fit fit.policy '${document.fit.policy}' even at compact density`,
        { code: plan.error.code, details: { oversetPt: plan.error.oversetPt, documentId: document.id } },
      );
    }

    const chosen = plan.attempt;
    const chosenTheme = chosen.density === 'compact' ? compactTheme : normalTheme;
    const renderer = this.#rendererFactory({
      theme: chosenTheme, texToSvg: this.#texToSvg, resolveAsset: this.#resolveAsset,
    });

    // Teacher key (spec §4.1, §12.1, Task 6): a RENDER MODE, orthogonal to
    // everything above — the fit loop, `document`, `chosen` density/theme,
    // `furnitureOpts` are ALL computed identically whether or not
    // `context.teacher` is set, so a teacher render can never choose a
    // different density/page-break plan for the student content than a
    // plain render of the same document would. `keyBlocks`/`keyTitle` are
    // appended by the renderer as EXTRA pages, entirely separately measured
    // and placed from the student content (see DocumentPdfRenderer.mjs's
    // `renderPlaced`) — never folded into the same fit/placement decision.
    const teacher = context.teacher === true;
    let keyBlocks = null;
    let keyTitle = null;
    const warnings = [...prepareWarnings];
    if (teacher) {
      const key = buildTeacherKeyBlocks(document, bank, chosenTheme.omr.letters);
      keyBlocks = key.blocks;
      keyTitle = key.title;
      if (key.warning) warnings.push(key.warning);
    }

    const result = await renderer.render(document, {
      studentName: context.learnerName ?? null,
      date: context.date ?? null,
      furniture: furnitureOpts,
      growLastPage: chosen.growLastPage ?? false,
      // v2's `*italic*` markdown grammar (spec §12.8) — v1 never opts in.
      // Measurement (`#measureAttempt` below) opts in with the SAME flag, so
      // wrap positions measured at fit-decision time can never drift from
      // what actually gets drawn here.
      italic: true,
      // Bank threading + score box (spec §3, §13, Task 5): `bank` backs
      // `createChoiceResolver` (DocumentPdfRenderer.mjs) for any inline
      // `omr_response` — never null when the document actually needs one
      // (see `#resolvePublishedBank`/`mergeBank`); `totalPoints` is a pure
      // passthrough, already summed by `#renderV2` above.
      bank,
      totalPoints,
      keyBlocks,
      keyTitle,
    });

    if (chosen.density === 'compact') {
      warnings.push(`fit.policy 'one-page' required compact density to fit '${document.id}' on one page`);
    }
    // `#renderV2` is PDF/Letter-always in Phase A (spec §13: no receipt path
    // wired for v2 yet) — a document declaring ONLY `target: ['receipt']`
    // still comes out as a Letter PDF, furniture and all, not the continuous
    // roll its own envelope promises. Honest at render time rather than a
    // silent mismatch (F6).
    if (Array.isArray(document.target) && document.target.length > 0
      && document.target.every((target) => target === 'receipt')) {
      warnings.push(
        `document '${document.id}' declares target: ['receipt'] but v2 rendering is PDF/Letter-always in `
        + 'Phase A — it was rendered as a Letter PDF, not a receipt',
      );
    }

    return {
      bytes: result.pdf, pageCount: result.pageCount, density: chosen.density, warnings,
    };
  }

  /**
   * `context.gutter` overrides the furniture default (`true`, i.e. the
   * theme's standard 3-hole-punch reservation — see `furniture.mjs`
   * `gutterSides`). A negative width would flip `contentBox`'s left/right
   * math into a nonsensical (negative-width) content area, so it is rejected
   * here rather than left for `contentBox` to silently mis-measure.
   */
  #resolveGutter(context) {
    const { gutter } = context;
    if (gutter === undefined) return true;
    if (typeof gutter === 'number' && gutter < 0) {
      throw new ValidationError('context.gutter must be >= 0', { code: 'INVALID_GUTTER', details: { gutter } });
    }
    return gutter;
  }

  /**
   * One density's trial: measure + place (furniture-aware, via `contentBox`)
   * to learn `pageCount`, and — only when it overflowed — `oversetPt`: how far
   * a single page's budget would have been exceeded, from `contentHeightPt`
   * (spec §7's fit contract). No bytes are produced here; the chosen attempt
   * is re-rendered for real once (see `#renderV2`) — same pure measure/place
   * functions either time, so the two calls cannot disagree about size.
   */
  #measureAttempt(document, theme, density, context, furnitureOpts, totalPoints) {
    // Computed BEFORE measurement so its gutter-adjusted `widthPt` reaches
    // the SAME measurement pass that decides wrap points (F2) — the final
    // render (`#renderV2` → DocumentPdfRenderer.renderPlaced) computes this
    // identically from the same `theme`/`furnitureOpts`, so a fit decision
    // made here can never disagree with what actually gets drawn.
    const box = contentBox(theme, furnitureOpts);
    const measurementDoc = this.#createMeasurementDocument({ theme });
    const fragments = this.#measureDocumentFragments(document, {
      doc: measurementDoc,
      theme,
      texToSvg: this.#texToSvg,
      resolveAsset: this.#resolveAsset,
      studentName: context.learnerName ?? null,
      widthPt: box.widthPt,
      // Must agree with the final render's `italic: true` (see #renderV2) —
      // a trial measured without it could pick a density that then wraps
      // differently once the real render turns *emphasis* spans on.
      italic: true,
      // Must agree with the final render's `totalPoints` (same reasoning) —
      // the score box adds a header line, so a fit decision measured without
      // it could pick a density that then doesn't actually fit once the real
      // render's header grows by one line.
      totalPoints,
    });
    const { pages } = this.#placeFragments(fragments, {
      pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing,
    });

    const pageCount = pages.length;
    let oversetPt = 0;
    if (pageCount > 1) {
      const totalPt = this.#contentHeightPt(fragments, { spacing: theme.spacing });
      const availablePt = box.pageHeightPt - 2 * box.marginPt;
      oversetPt = Math.max(0, totalPt - availablePt);
    }
    return { density, pageCount, oversetPt };
  }
}

export default RenderPrintDocument;
