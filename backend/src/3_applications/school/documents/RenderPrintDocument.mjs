/**
 * RenderPrintDocument — the v2 print pipeline assembled (spec §3 governing
 * idea 1, §7 fit orchestration). Validates either envelope generation, then:
 *
 *   - v1 (schema-less) documents delegate straight to the legacy renderer
 *     entry, UNCHANGED — same theme, same options shape, byte-identical to
 *     calling that renderer directly. v2 is additive, never a migration.
 *   - v2 documents run the fit loop `fit.mjs`'s own docs describe: measure at
 *     normal density always; measure again at compact ONLY when fit policy
 *     `one-page` or `prefer-one-page` needs the fallback (`flow`/`fill` never
 *     try compact — see `resolveFitPlan`); feed the measured attempt(s) to
 *     `resolveFitPlan`;
 *     render once, at the chosen density, with furniture (footer +
 *     archetype-driven gutter/duplex) and `growLastPage` threaded through.
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
import { planRows } from '#domains/school/documents/allocation.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg as mathJaxTexToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { createSubjectIconResolver } from '#rendering/school/documents/assetResolver.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/**
 * The header furniture already prints `document.title`; a leading rich_text
 * heading that repeats the SAME words printed the title twice, 40pt apart
 * (design audit #10). Authoring keeps both (the source is self-contained);
 * the render drops the echo.
 */
function dropRedundantTitleHeading(document) {
  const first = document.blocks?.[0];
  if (!document.title || first?.type !== 'rich_text' || typeof first.md !== 'string') return document;
  const heading = first.md.trim().replace(/^#+\s*/, '').trim();
  if (heading.toLowerCase() !== String(document.title).trim().toLowerCase()) return document;
  return { ...document, blocks: document.blocks.slice(1) };
}

/**
 * Archetypes bound through a physical binder get the alternating gutter (spec
 * §7 furniture). Everything else reserves its punch margin on the LEFT of every
 * page, which only survives being printed one-sided — hence this same set is
 * what the render reports as its `duplex` decision, and what the print job then
 * follows. Adding an archetype here changes page layout, so it needs its own
 * visual check, not just a printer setting.
 */
const DUPLEX_ARCHETYPES = new Set(['worksheet']);

/**
 * Archetypes that grow a header manifest line (Task 2, "10 questions · pass
 * 80%"). Scoped to `worksheet` — the household's own ask was specifically
 * about the worksheet header, and a quiz's header already carries the
 * archetype-driven `Score ____ / N` score box (spec §13) for the identical
 * "how much and what clears it" information; adding a SECOND, differently
 * worded line with the same job would be redundant on the one archetype that
 * already has it. Scoping this narrowly also means every fit-policy fixture
 * in this codebase's own test suite — which exercises `archetype: 'quiz'`
 * almost exclusively, tuned to page-break boundaries that predate this
 * feature — keeps its exact geometry: a manifest that grew EVERY v2
 * document's header by one line would have silently shifted those
 * boundaries, the same "measured, then invalidated by an unrelated feature"
 * failure mode `#measureAttempt`'s own `totalPoints`/`tokens` threading
 * exists to prevent.
 */
const MANIFEST_ARCHETYPES = new Set(['worksheet']);

/**
 * `banks` dependency for bank-select sugar (spec §6.2, Task 5): synchronous
 * `{getBank(id)}`, same shape `IssueDocument`/`PrintService`'s `bankReader`
 * already use elsewhere in this codebase — mirrored here rather than reused
 * because those two live in a different part of the School application (the
 * pre-Phase-B quiz/worksheet delivery path) with their own injection story.
 * Reads from `<dataDir>/content/school/learning-catalog/question-banks` — the SAME
 * layout `schoolCatalog.mjs`'s composition wiring resolves (against the
 * process's own `DAYLIGHT_BASE_PATH`) and the same data-root convention
 * `school.mjs docs`'s `resolveSchoolDocsContentPaths` resolves against
 * `--data-dir`/`$DAYLIGHT_BASE_PATH`.
 *
 * EXPORTED (review finding F5) so a caller that has ALREADY resolved its own
 * `dataDir` — `school.mjs docs`'s `--data-dir` flag, in particular — can
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
  const directory = path.resolve(resolvedDataDir, 'content/school/learning-catalog/question-banks');
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
      // `compact` puts the letter inline with its choice ("A. A pure heart").
      // The default `row` geometry exists to sit a letter beside a bubble;
      // no sheet prints bubbles, so `row` would strand the letter above its
      // own text. `worksheetInstanceDocument` already emits compact — this
      // makes a bank-select document match it.
      { type: 'omr_response', itemId: item.id, choices: item.choices.length, layout: 'compact' },
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

/**
 * Question COUNT (Task 2's header manifest), as distinct from `sumScoredPoints`'s
 * POINTS total — a document with one 5-point question and one 1-point question
 * has `totalPoints === 6` but `questionCount === 2`; a header that shows only
 * the point total would silently under-report how much paper work is actually
 * on the sheet. Same top-level-only scan, same reasoning: bank-select sugar
 * has already been expanded into concrete `question` blocks by the time this
 * runs (`#prepareV2Document`), and a `question` can never nest, so scanning
 * top-level blocks alone is complete.
 */
function countQuestions(blocks) {
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((total, block) => total + (block?.type === 'question' ? 1 : 0), 0);
}

/**
 * "10 questions · pass 80%" (household rule, Task 2: a child sees how much
 * sheet there is and what clears it without flipping to the footer or the
 * last page). The pass mark is appended ONLY when the caller actually
 * supplied one (`context.passPercent` — see `#renderV2Body`'s call site and
 * `IssueDocument`'s own doc comment on where that number comes from,
 * `unit.passing.percent`): a document with no known pass bar — a plain
 * worksheet outside a graded course, or any caller that hasn't threaded this
 * yet — still gets the count alone rather than a fabricated or stale
 * percentage. `questionCount <= 0` (an infopage, a reading-only worksheet)
 * returns null rather than printing "0 questions".
 */
function buildManifestText(questionCount, passPercent) {
  if (questionCount <= 0) return null;
  const countText = `${questionCount} question${questionCount === 1 ? '' : 's'}`;
  return Number.isFinite(passPercent) ? `${countText} · pass ${passPercent}%` : countText;
}

/**
 * Writes the computed manifest onto `document.header.manifest` — the SAME
 * "adjust the already-validated document immediately before it's measured"
 * seam `dropRedundantTitleHeading` already uses, so `measure.mjs`'s
 * `headerFragment` can read `manifest` as a precomputed string with no
 * policy of its own (see that function's own doc comment). A no-op — returns
 * `document` unchanged, not even a shallow copy — when there is nothing to
 * show, so a document with no questions never grows an empty header line or
 * an unnecessary object identity change.
 */
function withHeaderManifest(document, { questionCount, passPercent }) {
  const manifest = buildManifestText(questionCount, passPercent);
  if (!manifest) return document;
  return { ...document, header: { ...(document.header ?? {}), manifest } };
}

/**
 * Merges the document's own derived bank (if any) with bank-select-resolved
 * items into ONE `{id, items}` bank, or null if there is nothing at all.
 * EXPORTED (Task 6) so `ResolveCardScan`'s scan-back resolution (spec §5.4)
 * can rebuild the SAME merged bank a render produced, from the same two
 * inputs (a repository-resolved derived bank + `prepareV2Document`'s own
 * `extraItems`) — never a parallel merge.
 */
export function mergeBank(baseBank, extraItems, documentId) {
  const items = [...(baseBank?.items ?? []), ...extraItems];
  if (items.length === 0) return null;
  return { id: baseBank?.id ?? documentId, items };
}

/**
 * The public `{cardId, rowRange, recordId, status}` shape a card-attached
 * render exposes for its allocation — null for a render that never attached
 * to a card. Shared between `#renderV2Body`'s SUCCESS return and `#renderV2`'s
 * FAILURE path (Task 7 review, Finding 2: an error thrown after the
 * allocation write attaches this SAME shape to `err.details.allocation`, so
 * a caller can discover — and release — a card orphaned by a downstream fit/
 * render failure exactly as easily as it reads a successful render's own
 * `allocation` field).
 */
function allocationSnapshot(allocationRecord) {
  return allocationRecord ? {
    cardId: allocationRecord.cardId,
    rowRange: { ...allocationRecord.rowRange },
    recordId: allocationRecord.recordId,
    status: allocationRecord.status,
  } : null;
}

/**
 * `{bankId, select, key, filter?}` -> the first `select` items of
 * `applyShuffle(bank.items, deriveShuffle(seed, variant, key, bank.items.length))`
 * (spec §6.2's exact resolution formula). `filter` itself is handled by the
 * caller (`prepareV2Document`, which warns when it is present) — this
 * function only resolves the selection. Free function (not a class method)
 * so `prepareV2Document` below can run outside a `RenderPrintDocument`
 * instance — see that function's own doc comment.
 */
function resolveBankSelect(block, document, banks) {
  const bank = banks?.getBank ? banks.getBank(block.bankId) : null;
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
 *
 * EXPORTED, and taking an explicit `{banks}` instead of reading an
 * instance's own `this.#banks` (Task 6, spec §5.4): `ResolveCardScan`'s
 * scan-back resolution needs to re-derive EXACTLY the row->item mapping a
 * card-attached render produced — same bank-select expansion, same seeded
 * shuffles — from OUTSIDE a `RenderPrintDocument` instance. Rather than
 * re-implementing that formula on the grading side (a drift risk spec §4.3
 * exists specifically to avoid), this is the SAME function
 * `RenderPrintDocument#prepareV2Document` now delegates to (see that
 * instance method's own one-line wrapper, just below the class's
 * constructor-adjacent helpers) — one seam, two callers.
 */
export function prepareV2Document(document, { banks = null } = {}) {
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

    const selected = resolveBankSelect(block, document, banks);
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
      if (item) {
        // A card-attached render (Task 5's `#renumberQuestions`) strips
        // `.number` off a non-row-consuming question entirely — printed
        // numbers ARE card rows (spec §5.3), so an unnumbered write-on
        // question falls back to the SAME prompt-clip label a standalone
        // `short_answer` sugar entry already uses below, rather than
        // printing the literal string "undefined.".
        const label = typeof block.number === 'number' ? `${block.number}.` : `"${truncatePrompt(item.prompt)}" —`;
        entries.push({ label, text: formatAnswer(item, letters) });
      }
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
  #placeFragments; #contentHeightPt; #texToSvg; #resolveAsset; #legacyRenderer; #banks; #allocationStore;

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
   * @param {{allocate: Function}|null} [deps.allocationStore] - OMR card allocation
   *   store (spec §5.3/§5.4, Task 5: `YamlAllocationStore`-shaped — `allocate({cardId?,
   *   request})`). Required only for a card-attached render (`context.cardId`/`freshCard`
   *   set) — absent it, that render mode fails with a structured `ALLOCATION_STORE_REQUIRED`
   *   error rather than silently skipping allocation.
   */
  constructor({
    repository = null,
    banks = null,
    renderer = createDocumentPdfRenderer,
    measure = { createMeasurementDocument, measureDocumentFragments },
    layout = { placeFragments, contentHeightPt },
    texToSvg = mathJaxTexToSvg,
    resolveAsset = createSubjectIconResolver(),
    allocationStore = null,
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
    this.#allocationStore = allocationStore;
    // The legacy (v1) render target: default theme, no furniture, no
    // growLastPage — literally what `createDocumentPdfRenderer(...)` already
    // meant before this use case existed.
    this.#legacyRenderer = this.#rendererFactory({ texToSvg: this.#texToSvg, resolveAsset: this.#resolveAsset });
  }

  /**
   * @param {Object} args
   * @param {Object} [args.document] - a raw (unvalidated) document, v1 or v2 envelope
   * @param {string} [args.id] - looked up via `repository` when `document` is not given
   * @param {{learnerName?: string, date?: string, gutter?: boolean|number, teacher?: boolean,
   *   cardId?: string, startRow?: number, freshCard?: boolean, learnerId?: string,
   *   tokens?: Object<string,string>, passPercent?: number}} [args.context] -
   *   `learnerName`/`date` prefill the header's Name/Date lines (blank ruled lines
   *   when absent); `gutter` overrides the default 3-hole-punch reservation
   *   (v2 only — must be >= 0). `teacher` (v2 only, spec §4.1/§12.1) is a RENDER
   *   MODE, orthogonal to `seed`/`variant`: it prints the identical student
   *   pages this same call would have produced without it, then appends a
   *   dense answer-key section built from the resolved bank. Ignored on the
   *   v1 (legacy) path — v1 has no teacher-key concept. `cardId`/`startRow`/
   *   `freshCard` (v2 only, spec §5.3/§5.4, Task 5) attach the render to an
   *   OMR card: either supply an existing `cardId` (reprint/continuation) or
   *   `freshCard: true` (the store mints a random one); `startRow` (default 1)
   *   is where row planning begins. Attaching a card requires `deps.allocationStore`
   *   — see the constructor doc. `learnerId` (distinct from the display-only
   *   `learnerName`) threads into the allocation record for supersede/lookup.
   *   `teacher` mode renders its key numbers from the SAME allocation as the
   *   student sheet when both are set on one call. `tokens` (F3 review fix,
   *   Medium/blocker) — action value → already-minted token, the SAME
   *   `IDocumentRenderer`/`DocumentPdfRenderer#render` `options.tokens`
   *   contract every legacy caller already threads (see that option's own
   *   doc comment): drawn in a `scan_action`/`media_action` block's barcode
   *   text instead of the block's own `.action` literal. `IssueDocument`
   *   mints these BEFORE calling this use case (`#mintSheetTokens`) and hands
   *   them through here — omitted (every caller before this field existed)
   *   falls back to `block.action`/`.code`/`.token` exactly as before
   *   (`measure.mjs`'s `actionCodeText`), so a document with no action blocks,
   *   or a caller that never mints tokens, is unaffected. `passPercent`
   *   (Task 2's header manifest) — the household's pass bar for THIS lesson
   *   ("10 questions · pass 80%"), a plain number 1-100. `IssueDocument`
   *   threads `unit.passing?.percent` through here for a worksheet-instance
   *   render — the SAME field `GradeSubmission`/`CloseSessionOutcome` already
   *   treat as the authoritative pass mark for closing that session, so the
   *   sheet can never print a bar that disagrees with what actually grades
   *   it. Omitted/null (every caller before this field existed, or a lesson
   *   with no configured pass bar) prints the question count alone, never a
   *   fabricated percentage.
   * @returns {Promise<{bytes: Buffer, pageCount: number, density: 'normal'|'compact'|null,
   *   warnings: string[], allocation: {cardId: string, rowRange: {start: number, end: number},
   *   recordId: string, status: string}|null, duplex: boolean|null}>}
   *   `density` is null for a v1 (legacy-path) document, which has no density concept.
   *   `allocation` is null for every render that did not attach to a card.
   *   `duplex` is the geometry this render actually drew — true when the gutter
   *   alternates by page parity, false when it is fixed to the left of every
   *   page, null on the v1 path, which draws no gutter at all. Pass it to
   *   `printPdf({ duplex })` so the sheet is folded the way it was drawn.
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
    const result = await this.#legacyRenderer.render(document, {
      studentName: context.learnerName ?? null,
      // F3: threaded the same as v2 below — omitted/null (every caller before
      // this field existed) reproduces the prior call byte-for-byte.
      tokens: context.tokens ?? null,
    });
    return {
      bytes: result.pdf,
      pageCount: result.pageCount,
      density: null,
      warnings: [],
      allocation: null,
      // v1 draws no page furniture at all (no gutter is reserved, on either
      // side), so it has no duplex decision to express — null, and the caller
      // leaves the printer on its configured default rather than inventing one
      // on the legacy path's behalf.
      duplex: null,
    };
  }

  /** Instance-bound wrapper over the exported `prepareV2Document` (Task 6 seam), closing over this instance's own `#banks` reader. */
  #prepareV2Document(document) {
    return prepareV2Document(document, { banks: this.#banks });
  }

  /** v2: fit loop, then one furniture-aware render at the chosen density. */
  async #renderV2(rawDocument, context, { bank: baseBank = null } = {}) {
    const { document: prepared, extraItems, warnings: prepareWarnings } = this.#prepareV2Document(rawDocument);
    const bank = mergeBank(baseBank, extraItems, prepared.id);

    // Validated FIRST, before any allocation write: a bad `context.gutter`
    // must fail before a card-attached render's store write, not after —
    // there is no rollback here, so a rejected render must never have
    // side-effected an allocation record.
    const gutter = this.#resolveGutter(context);

    // Card allocation (spec §5.3/§5.4, Task 5): a card-attached render plans
    // rows against the FIRST-PASS prepared document (numbers 1..N — `planRows`
    // reads `itemId`/`points`/`omr`, never `.number`, so first-pass numbering
    // is irrelevant to row planning), writes/reuses the allocation record via
    // the injected store, then renumbers the document from `planRows`'s own
    // rows (`#renumberQuestions`) — "the record is the numbering truth,"
    // never the render's own request. A quiz rendered with NO card context is
    // still a legal (proof/preview) render, but warns — a tracked quiz is
    // expected to carry allocation (Task 7 wires that expectation in).
    const warnings = [...prepareWarnings];
    const cardContext = this.#resolveCardContext(context);
    let document = dropRedundantTitleHeading(prepared);
    let allocationRecord = null;
    if (cardContext) {
      // Teacher history may replay a frozen card mapping, but it must never
      // call the allocation store. The historical record is deliberately a
      // render-only snapshot: it supplies the same printed row numbers while
      // making a GET incapable of minting or reusing a physical card.
      const allocation = cardContext.historical
        ? this.#historicalCard(prepared, bank, cardContext)
        : await this.#allocateCard(prepared, bank, cardContext);
      allocationRecord = allocation.record;
      document = dropRedundantTitleHeading(this.#renumberQuestions(prepared, allocation.rows));
    } else if (prepared.archetype === 'quiz') {
      warnings.push(`quiz '${prepared.id}' rendered without card allocation`);
    }

    // ORPHAN VISIBILITY (Task 7 review, Finding 2): everything from here down
    // can still throw (fit-policy rejection, an asset the renderer cannot
    // resolve, ...) — AFTER the allocation write above already went durable.
    // There is no rollback (the write can't be "undone" mid-transaction, and
    // shouldn't be: the paper-out-of-tray guarantee this all exists for is
    // about never letting a scan outrun a mapping, not about erasing history)
    // but a caller must be able to DISCOVER what got orphaned — the fresh
    // card's id is otherwise unknowable from outside (a `freshCard: true`
    // render never hands its minted cardId back on the happy path alone).
    // `allocationSnapshot` is attached to the thrown error's `details` so
    // `IssueDocument` (or any card-attached caller) can release it rather
    // than silently burning a physical card per retry.
    try {
      return await this.#renderV2Body({
        document, bank, cardContext, allocationRecord, context, warnings, gutter,
      });
    } catch (err) {
      if (allocationRecord && err && typeof err === 'object') {
        err.details = { ...(err.details ?? {}), allocation: allocationSnapshot(allocationRecord) };
      }
      throw err;
    }
  }

  /**
   * The rest of `#renderV2` (fit loop through the final render + return) —
   * split out only so `#renderV2` can wrap the whole thing in one try/catch
   * (Finding 2 above); no behavior change from the original inline body.
   */
  async #renderV2Body({
    document, bank, cardContext, allocationRecord, context, warnings, gutter,
  }) {
    const totalPoints = sumScoredPoints(document.blocks, document.defaultPoints);

    // Geometry only. The footer's card number comes from the render's own
    // `card` context inside `DocumentPdfRenderer`, not from here.

    // Header manifest (Task 2): computed and written onto `document.header`
    // BEFORE either fit-loop trial measures anything, not just before the
    // final render — the manifest line has real height (measure.mjs's
    // `headerFragment` adds a leading for it), so a trial that didn't know
    // about it could choose a density that then doesn't actually fit once
    // the real render's header grows by one line, exactly the class of bug
    // `#measureAttempt`'s `totalPoints`/`tokens` threading already guards
    // against (see that method's own comments). `document` is reassigned
    // here (not a new local) so every use below — both trials AND the final
    // `renderer.render(document, ...)` call — sees the SAME manifest-bearing
    // document.
    if (MANIFEST_ARCHETYPES.has(document.archetype)) {
      document = withHeaderManifest(document, {
        questionCount: countQuestions(document.blocks),
        passPercent: context.passPercent,
      });
    }


    const furnitureOpts = {
      gutter,
      duplex: DUPLEX_ARCHETYPES.has(document.archetype),
    };

    const normalTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'normal' });
    const normalAttempt = this.#measureAttempt(document, normalTheme, 'normal', context, furnitureOpts, totalPoints);

    const attempts = [normalAttempt];
    let compactTheme = null;
    // Measurement at compact density is run ONLY when `one-page` OR
    // `prefer-one-page` needs the fallback (`fit.mjs`'s own contract) —
    // `flow`/`fill` never try compact. Both policies share this same
    // gate/condition because they share the same first move ("try normal,
    // and only pay for a second measurement pass if normal didn't already
    // land on one page") — they diverge only in what `resolveFitPlan` does
    // with the result once compact ALSO fails to reach one page: `one-page`
    // rejects the render outright, `prefer-one-page` spills at compact
    // density rather than failing (see `resolveFitPlan`'s own doc comment).
    if ((document.fit.policy === 'one-page' || document.fit.policy === 'prefer-one-page')
      && normalAttempt.pageCount !== 1) {
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

    // Balanced spill (household rule: "we're not just having a dangling
    // question number 10 at the end" — equal vertical fill, not equal
    // question COUNT) is decided HERE, not inside `resolveFitPlan`.
    // `fit.mjs` deliberately stays a pure decision table — it hands back
    // whichever measured attempt satisfies the policy and stops there (see
    // its own doc comment); it does not inspect its own output to decide
    // whether to decorate it. Whether a `prefer-one-page` render needs
    // balancing is exactly that kind of post-hoc, render-shaped question —
    // it's true only when THIS document actually spilled (`chosen.pageCount
    // > 1` on the attempt `resolveFitPlan` just returned), which is a fact
    // this use case is already licensed to reason about (see the file
    // header: this is the one place allowed to run rendering's measurement
    // loop). `growLastPage` here has two independent triggers: `fill`'s is
    // unconditional on the policy alone (every `fill` render always grows —
    // that half still lives in `fit.mjs`, on the attempt itself, because
    // it's genuinely policy-only); `prefer-one-page`'s spill needs it too,
    // for a different reason — `layout.mjs`'s `distributeAnswerSpace` grows
    // every page's trailing answer-space EXCEPT the last one by default, so
    // a balanced split would otherwise still show the earlier page(s)
    // stretched flush to the margin while the last page — never grown under
    // that default — sits well short of it, undoing the evenness `balance`
    // just achieved. Confirmed empirically against the atlas worst-case
    // fixture: balance alone left the two pages ~41pt and ~319pt short of
    // their margin respectively; adding `growLastPage: true` closed that to
    // ~41pt and ~27pt. `balance` itself is a no-op on content it can't
    // safely re-partition, so threading it whenever the document actually
    // spilled costs nothing on one it can't help.
    const spilledPreferOnePage = document.fit.policy === 'prefer-one-page' && chosen.pageCount > 1;
    const growLastPage = (chosen.growLastPage ?? false) || spilledPreferOnePage;
    const balance = (chosen.balance ?? false) || spilledPreferOnePage;

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
    if (teacher) {
      // `document` here is ALREADY the card-renumbered document (when
      // card-attached) — `collectAnswerKeyEntries` reads `block.number`
      // straight off it, so the key's numbers are the SAME offset numbering
      // the student sheet just printed (spec §5.4 "the teacher key is
      // rendered per allocation ... including startRow offsets", Task 5).
      const key = buildTeacherKeyBlocks(document, bank, chosenTheme.omr.letters);
      keyBlocks = key.blocks;
      keyTitle = key.title;
      if (key.warning) warnings.push(key.warning);
    }

    // Card header strip (spec §5.2, Task 4's render option): drawn only for
    // a card-attached render; `firstUse` mirrors a FRESH card mint, never a
    // supplied (reprint/continuation) `cardId`.
    const card = allocationRecord ? {
      cardId: allocationRecord.cardId,
      startRow: allocationRecord.rowRange.start,
      endRow: allocationRecord.rowRange.end,
      firstUse: cardContext.freshCard === true,
    } : (context.previewCard ?? null);

    const result = await renderer.render(document, {
      studentName: context.learnerName ?? null,
      date: context.date ?? null,
      furniture: furnitureOpts,
      growLastPage,
      // Same fit-plan flag family as `growLastPage` (see fit.mjs): policy
      // `fill` asks for balanced page assignment so the pages it just told us
      // to bottom out don't strand a handful of stretched questions on the
      // last one.
      // A worksheet that spills under `prefer-one-page` has already tried the
      // compact fit. Once it genuinely needs another page, balance whole
      // question fragments so it cannot leave a tiny question dangling alone.
      balance,
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
      card,
      totalPoints,
      keyBlocks,
      keyTitle,
      // Tracked-quiz tokens (F3 review fix, Medium/blocker): a scan_action/
      // media_action block's printed barcode must be the token `IssueDocument`
      // actually minted and registered — never the block's own `.action`
      // literal (measure.mjs's `actionCodeText` fallback), which would print
      // a dead barcode while a live token sits in the registry. Omitted/null
      // (every caller before this field existed) reproduces the prior call
      // byte-for-byte.
      tokens: context.tokens ?? null,
    });

    if (chosen.density === 'compact') {
      // `one-page` can only ever reach this branch with a `chosen` attempt
      // that measured `pageCount === 1` — a compact attempt that still
      // overflowed takes the FIT_OVERSET throw above instead, never
      // `chosen`. `prefer-one-page` CAN reach here with a spilled `chosen`
      // (its whole point is to spill rather than fail — see `resolveFitPlan`),
      // so the warning has to say which of the two actually happened.
      //
      // Deliberately reads `result.pageCount` (the REAL render this call just
      // produced — the SAME "whole artifact" count `DocumentPdfRenderer.render`
      // documents and every other caller of this method already reports),
      // not `chosen.pageCount` (the TRIAL's prediction from `#measureAttempt`).
      // The two can legitimately disagree in either direction:
      //   - `#measureAttempt` never threads `bank` through to `resolveChoices`,
      //     so any `omr_response` block is measured in measure.mjs's own
      //     "probe mode" (a conservative reservation) during the trial —
      //     which can make the trial predict MORE student pages than the real,
      //     bank-aware render actually needs.
      //   - a teacher render (`context.teacher`) appends key pages AFTER the
      //     fit decision (`chosen` only ever describes the STUDENT content —
      //     see the "Teacher key" comment below), so `result.pageCount` can be
      //     LARGER than `chosen.pageCount` simply because the answer key added
      //     pages the fit loop was never asked about.
      // Either way, a diagnostic warning's page number has to be the number
      // that was really printed, not a prediction from an earlier pass.
      warnings.push(result.pageCount === 1
        ? `fit.policy '${document.fit.policy}' required compact density to fit '${document.id}' on one page`
        : `fit.policy '${document.fit.policy}' could not fit '${document.id}' on one page even at compact density; spilled to ${result.pageCount} pages`);
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
      bytes: result.pdf,
      pageCount: result.pageCount,
      density: chosen.density,
      warnings,
      allocation: allocationSnapshot(allocationRecord),
      // The document's OWN duplex decision, surfaced so the print job can
      // match the geometry that was just drawn. `furnitureOpts.duplex` is what
      // decided whether the 3-hole-punch gutter alternates by page parity
      // (mirror margins) or sits on a fixed left edge on every page. Printing
      // a fixed-gutter document double-sided puts page 2's reserved punch
      // margin on the opposite physical edge from page 1's while the two share
      // one sheet — punching that stack destroys content on every verso. So
      // the caller passes this straight through to `printPdf({ duplex })`
      // rather than letting a global adapter default decide the physical form
      // of a document it never looked at.
      duplex: furnitureOpts.duplex,
    };
  }

  /**
   * Card-attachment intent from `context` (spec §5.3, Task 5): present
   * whenever a `cardId` is supplied OR a fresh card is requested. `startRow`
   * defaults to 1 — the convenience default ("a tracked quiz render with no
   * cardId allocates a fresh random card starting at row 1"); `planRows`
   * itself validates it. Returns null for every render that isn't
   * card-attached — the common, non-card v2 path, unchanged.
   */
  #resolveCardContext(context) {
    const {
      cardId, freshCard, startRow, learnerId, sessionId, sectionAttribution, historicalCard,
    } = context;
    if (cardId === undefined && freshCard !== true) return null;
    if (historicalCard === true && (typeof cardId !== 'string' || freshCard === true)) {
      throw new ValidationError('historical card replay requires an existing cardId and may not request a fresh card', {
        code: 'HISTORICAL_CARD_CONTEXT_INVALID',
      });
    }
    return {
      cardId,
      freshCard: freshCard === true,
      historical: historicalCard === true,
      startRow: startRow ?? 1,
      learnerId: learnerId ?? null,
      // Work-session lineage (review wave B1): IssueDocument's tracked-quiz
      // path passes its sessionId so the allocation record — the one durable
      // artifact a scan resolves — can carry the link back to the session a
      // graded scan must advance. Absent for every other caller.
      sessionId: sessionId ?? null,
      // A composed worksheet has one physical allocation but several
      // independently completable lesson sections. The composer supplies
      // its immutable item ownership here; allocation converts it to row
      // ranges after planning the exact rendered document.
      sectionAttribution: sectionAttribution ?? null,
    };
  }

  /**
   * Card-attached render flow (spec §5.3/§5.4, Task 5): plan rows against the
   * PREPARED document (bank-select sugar already expanded — `#prepareV2Document`'s
   * output; `document` here still carries its first-pass 1..N numbering,
   * which `planRows` never reads) and the merged bank, then write/reuse the
   * allocation record via the injected store.
   *
   * Returns `{record, rows}` — `rows` is `planRows`'s own output (the SAME
   * candidates, in the SAME order, that the persisted `rowRange` was derived
   * from), which the caller feeds straight into `#renumberQuestions`. The
   * record's `rowRange.start` matches `rows[0].row` by construction (this
   * method builds the request's `rowRange` FROM `rows`); nothing here assumes
   * the store could adjust it, but `rows` — not a recomputed offset — is the
   * one source `#renumberQuestions` reads, since it is what's ACTUALLY correct
   * even for a worksheet with gaps between row-consuming questions.
   */
  async #allocateCard(document, bank, {
    cardId, freshCard, startRow, learnerId, sessionId, sectionAttribution,
  }) {
    if (!this.#allocationStore) {
      throw new ValidationError(
        `document '${document.id}' requested card allocation (cardId/freshCard) but no allocationStore is `
        + 'configured',
        { code: 'ALLOCATION_STORE_REQUIRED', details: { documentId: document.id } },
      );
    }
    if (typeof document.rev !== 'string' || document.rev.trim().length === 0) {
      throw new ValidationError(
        `document '${document.id}' has no rev; card allocation requires a published document`,
        { code: 'ALLOCATION_REQUIRES_REV', details: { documentId: document.id } },
      );
    }

    const plan = planRows({ document, bank, startRow });
    if (plan.errors) {
      throw new ValidationError(
        `document '${document.id}' failed card row planning: ${plan.errors.join('; ')}`,
        { code: 'ALLOCATION_ROW_PLAN_INVALID', details: { documentId: document.id, errors: plan.errors } },
      );
    }
    if (plan.rows.length === 0) {
      throw new ValidationError(
        `document '${document.id}' has no row-consuming questions to allocate a card to`,
        { code: 'ALLOCATION_NO_ROWS', details: { documentId: document.id } },
      );
    }

    const rowRange = { start: plan.rows[0].row, end: plan.rows[plan.rows.length - 1].row };
    const rowByItemId = new Map(plan.rows.map((row) => [row.itemId, row.row]));
    const sections = sectionAttribution == null ? null : sectionAttribution.map((section) => {
      if (!section || typeof section.id !== 'string' || !Array.isArray(section.itemIds)) {
        throw new ValidationError('sectionAttribution entries require id and itemIds', {
          code: 'ALLOCATION_SECTION_ATTRIBUTION_INVALID', details: { documentId: document.id },
        });
      }
      const rows = section.itemIds.map((itemId) => rowByItemId.get(itemId));
      if (!rows.length || rows.some((row) => !Number.isInteger(row))) {
        throw new ValidationError(`section '${section.id}' does not own rendered OMR rows`, {
          code: 'ALLOCATION_SECTION_ATTRIBUTION_INVALID', details: { documentId: document.id, sectionId: section.id },
        });
      }
      return {
        id: section.id,
        rowRange: { start: Math.min(...rows), end: Math.max(...rows) },
        ...(section.worksheetInstanceId ? { worksheetInstanceId: section.worksheetInstanceId } : {}),
        ...(section.sessionId ? { sessionId: section.sessionId } : {}),
        ...(section.lessonId ? { lessonId: section.lessonId } : {}),
        ...(section.subjectId ? { subjectId: section.subjectId } : {}),
        ...(section.courseId ? { courseId: section.courseId } : {}),
      };
    });
    const request = {
      documentId: document.id,
      rev: document.rev,
      seed: document.seed,
      variant: document.variant ?? 0,
      rowRange,
      ...(learnerId != null ? { learnerId } : {}),
      ...(sessionId != null ? { sessionId } : {}),
      ...(sections ? { sections } : {}),
      // F4 (bank-select scan integrity vs mutable external banks): the row->
      // item mapping `planRows` JUST resolved, straight off THIS document/bank
      // pair — the store persists it verbatim as `rowItems` so a later scan
      // can tell "the bank changed since this card was printed" apart from
      // "this bank-select document really does resolve differently," rather
      // than trusting a fresh re-derivation (`ResolveCardScan`'s reuse-the-
      // render-seam design) that a mutated external bank file would silently
      // corrupt.
      rowItems: plan.rows.map(({ row, itemId, itemType }) => ({ row, itemId, itemType })),
    };
    const record = await this.#allocationStore.allocate({ cardId: freshCard ? undefined : cardId, request });
    return { record, rows: plan.rows };
  }

  /** Build the card geometry for a historical replay without touching storage. */
  #historicalCard(document, bank, { cardId, startRow }) {
    const plan = planRows({ document, bank, startRow });
    if (plan.errors || plan.rows.length === 0) {
      throw new ValidationError(
        `document '${document.id}' cannot replay its historical card mapping`,
        { code: 'HISTORICAL_CARD_PLAN_INVALID', details: { documentId: document.id, errors: plan.errors ?? [] } },
      );
    }
    return {
      record: {
        cardId,
        recordId: null,
        status: 'historical-replay',
        rowRange: { start: plan.rows[0].row, end: plan.rows.at(-1).row },
      },
      rows: plan.rows,
    };
  }

  /**
   * Printed numbers ARE card row numbers (spec §5.3, fix round 1 review
   * finding 1 — CRITICAL): a row-consuming top-level `question` prints
   * EXACTLY the row `planRows` assigned it (contiguous from the record's own
   * startRow, in document order — `rows` here is that same output, not a
   * recomputed offset), and every OTHER top-level `question` — a worksheet's
   * non-`omr` write-on block, which `planRows` skips entirely when assigning
   * physical card rows — prints NO number at all.
   *
   * A single "shift every question's number uniformly" scheme (this
   * function's first cut) is WRONG whenever a skipped question sits between
   * two row-consuming ones: the shifted number and the real row silently
   * diverge, and the printed number is the student's ONLY instruction for
   * which physical row to bubble — that mismatch is exactly the sheet-to-card
   * confusion this whole allocation system exists to prevent. Two parallel
   * numbering sequences (one for rows, one counting write-on questions) would
   * invite the identical confusion, so unnumbered is the only safe choice —
   * mirrors the standalone `short_answer` sugar precedent (prompt stands
   * alone, no leading number). `buildTeacherKeyBlocks`/`collectAnswerKeyEntries`
   * fall back to the item's own prompt-clip label for a number-less question
   * (same fallback `short_answer` entries already use).
   *
   * Bank-select expansion/shuffling already ran (`#prepareV2Document`), so
   * this is a pure renumbering pass over an otherwise-final document; a
   * `question` can never nest inside another `question` or an `inset`
   * (`blocks.mjs`), and every row-consuming candidate `planRows` finds is
   * therefore top-level — `rows[].blockPath` is always exactly `blocks[N]`
   * for some top-level index N, never a nested path.
   *
   * @param {object} document
   * @param {Array<{row:number, blockPath:string}>} rows - `planRows`'s own output
   */
  #renumberQuestions(document, rows) {
    const rowByIndex = new Map();
    for (const { row, blockPath } of rows) {
      const match = /^blocks\[(\d+)\]$/.exec(blockPath);
      if (match) rowByIndex.set(Number(match[1]), row);
    }
    return {
      ...document,
      blocks: document.blocks.map((block, index) => {
        if (block?.type !== 'question') return block;
        if (rowByIndex.has(index)) return { ...block, number: rowByIndex.get(index) };
        const { number, ...unnumbered } = block;
        return unnumbered;
      }),
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
      // Must agree with the final render's `tokens` (F3, same reasoning as
      // italic/totalPoints above): a token's printed text is a fixed-height
      // action-box glyph (`theme.action.heightPt`), so it can never itself
      // change page count — but measuring with a DIFFERENT tokens map (or
      // none) than what actually gets drawn is exactly the kind of
      // measure/draw disagreement this precedent exists to rule out on
      // principle, not just where it happens to matter today.
      tokens: context.tokens ?? null,
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
