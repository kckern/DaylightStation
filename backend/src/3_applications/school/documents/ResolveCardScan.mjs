/**
 * ResolveCardScan — scan-back resolution + grading (spec §5.4 allocation
 * lifecycle / scan-back resolution, §5.5 `multi_select` grading).
 *
 * Turns a decoded OMR sheet (`quizScanRecorder.mjs`'s `decodeQuizSheet`
 * output, `{testId, answers: {row: 'A'|['A','E']}}`) into a graded result
 * per allocation record the physical card carries. The decoded `testId` IS
 * the card id (spec §5.2) — this resolver is the ONE place that maps it to
 * document(s)/bank(s)/rows: "its testId→student/key mapping is superseded
 * by the allocation store — one resolver, no parallel mapping" (spec §5.2).
 *
 * REUSE, NOT RE-DERIVE: the row→item mapping must reproduce EXACTLY what
 * the render printed, including bank-select expansion and seeded shuffles
 * (spec §4.3's "shuffle derives from (seed, variant, block key)"). Rather
 * than re-implementing that formula on the grading side — a drift risk the
 * spec calls out by name — this resolver reuses `RenderPrintDocument`'s own
 * preparation seam: `prepareV2Document` + `mergeBank`, both exported from
 * `RenderPrintDocument.mjs` for this exact purpose (see that module's own
 * doc comments on both), then feeds the SAME `planRows` domain function the
 * render used to plan card rows in the first place.
 *
 * ROW REUSE / NEWEST CLAIMANT WINS: a card's physical rows can legally be
 * reallocated once their prior claimant has settled (`satisfied`) — the
 * allocation store's collision check only blocks an overlapping `live`
 * range (spec §5.4). A scan therefore never trusts a record's own `rowRange`
 * in isolation: `resolveRowOwners` below resolves ONE owner per row across
 * every live|satisfied record on the card first, and each record grades
 * only the rows it still owns. A record that owns none of the rows actually
 * marked this scan (every one of them lost to a newer printing) is omitted
 * from the result entirely — see `resolveRowOwners`'s own doc comment.
 *
 * Pure-ish: every dependency (`allocationStore`, `repository`, `banks`) is
 * constructor-injected. No composition wiring happens here — that is
 * Task 7's job.
 */
import { DomainInvariantError, EntityNotFoundError } from '#domains/core/errors/index.mjs';
import { sha256Text } from '#system/utils/CanonicalFingerprint.mjs';
import { planRows, resolveAmbiguousCardId } from '#domains/school/documents/allocation.mjs';
import { gradeAnswer } from '#domains/school/grading.mjs';
import { creditsAsEraser, leniencyCap } from '#domains/school/documents/ambiguityLeniency.mjs';
import {
  CODE_LETTERS, GATE_SATISFIED, GATE_BLANK, GATE_WRONG, GATE_EXHAUSTED,
} from '#domains/school/companionCode.mjs';
import { prepareV2Document, mergeBank } from './RenderPrintDocument.mjs';

/**
 * Card answer-position letters A-E (spec §5.1's five bubbles per row,
 * `allocation.mjs`'s `ROW_CHOICES = 5`) — the SAME fixed alphabet
 * `quizScanRecorder.mjs`'s `decodeQuizSheet` decodes marks into, and the
 * first five characters of the render theme's own `omr.letters`
 * (`workbookTheme.mjs`). Hardcoded here (rather than imported from either)
 * because this application layer never reaches into `1_rendering` (see
 * `RenderPrintDocument.mjs`'s own D1 note on that boundary), and
 * `quizScanRecorder.mjs`'s copy is a local, unexported constant.
 */
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function canonicalAnswerRows(answers) {
  return Object.entries(answers ?? {})
    .map(([row, marks]) => ({
      row: Number(row),
      marks: (Array.isArray(marks) ? marks : [marks]).map(String).sort(),
    }))
    .filter((entry) => Number.isInteger(entry.row))
    .sort((left, right) => left.row - right.row);
}

function scanFingerprint(cardId, answers) {
  return sha256Text(JSON.stringify({ cardId: String(cardId), rows: canonicalAnswerRows(answers) }));
}

const isLiveOrSatisfied = (status) => status === 'live' || status === 'satisfied';

/** Inclusive `{start, end}` -> `[start, start+1, ..., end]`. */
function rowsInRange({ start, end }) {
  const rows = [];
  for (let row = start; row <= end; row += 1) rows.push(row);
  return rows;
}

/** `record.status` ordinal for the ROW-OWNERSHIP tiebreak below — `live` (an active claim) outranks `satisfied` (a settled one). */
const STATUS_RANK = { live: 1, satisfied: 0 };

/**
 * Is `candidate` (`{record, index}`, `index` its position in the eligible-
 * records list) a NEWER claim on a row than `current` (spec §5.4 review fix
 * — "newest claimant wins per row")? Compared in order: latest `renderedAt`
 * wins; ties broken by status (`live` beats `satisfied`); remaining ties
 * broken by `findByCard`'s own oldest-first record order (a later index is
 * the more recently created record).
 */
function isNewerClaim(candidate, current) {
  if (candidate.record.renderedAt !== current.record.renderedAt) {
    return candidate.record.renderedAt > current.record.renderedAt;
  }
  if (STATUS_RANK[candidate.record.status] !== STATUS_RANK[current.record.status]) {
    return STATUS_RANK[candidate.record.status] > STATUS_RANK[current.record.status];
  }
  return candidate.index > current.index;
}

/**
 * Row ownership across every live|satisfied record on a card (spec §5.4
 * review fix, CRITICAL: silent double-grading on card row reuse). A
 * `satisfied` record's rows are NOT protected from reallocation —
 * `checkCollision` (`allocation.mjs`) only blocks an overlapping `live`
 * range, so a card's physical rows can legally be reprinted for a
 * completely different document once the prior claimant has settled. Without
 * a single deterministic owner per row, a mark on a reused row would grade
 * against every claimant's answer key at once — this function is what
 * prevents that: "physical card = latest printing wins," one owner per row,
 * decided by `isNewerClaim` above.
 *
 * @param {object[]} eligibleRecords - live|satisfied records, `findByCard`'s
 *   own oldest-first order (order matters — see `isNewerClaim`'s last tiebreak)
 * @returns {Map<number, object>} row number -> the ONE record that owns it
 */
function resolveRowOwners(eligibleRecords) {
  const claims = new Map(); // row -> {record, index}
  eligibleRecords.forEach((record, index) => {
    const candidate = { record, index };
    for (const row of rowsInRange(record.rowRange)) {
      const current = claims.get(row);
      if (!current || isNewerClaim(candidate, current)) {
        claims.set(row, candidate);
      }
    }
  });
  const owners = new Map();
  for (const [row, claim] of claims) owners.set(row, claim.record);
  return owners;
}

/**
 * `blocks[N]` -> `N`, mirroring `RenderPrintDocument#renumberQuestions`'s own
 * regex: every row-consuming candidate `planRows` finds is top-level (a
 * `question` can never nest inside another `question` or an `inset` —
 * `blocks.mjs`), so `blockPath` is always exactly this shape.
 */
function blockIndexFromPath(blockPath) {
  const match = /^blocks\[(\d+)\]$/.exec(blockPath);
  return match ? Number(match[1]) : null;
}

/**
 * A row-mapped item's `points` (spec §5.5's "the points value rides the
 * item like any other"): the printed question block's own override, or the
 * prepared document's `defaultPoints` — read off the SAME prepared document
 * `planRows` just walked, never re-derived from the bank item itself (which
 * carries no points of its own).
 */
function pointsForRow(preparedDocument, blockPath) {
  const index = blockIndexFromPath(blockPath);
  const block = index !== null ? preparedDocument.blocks[index] : null;
  if (typeof block?.points === 'number') return block.points;
  return typeof preparedDocument.defaultPoints === 'number' ? preparedDocument.defaultPoints : 1;
}

/**
 * A write-on's display prompt: the first `rich_text` child's `md` for a
 * top-level `question` block (mirrors `questionPrompts`'s own concatenation
 * seed, `documentValidation.mjs`), or a standalone `short_answer`/`essay`
 * sugar block's own `prompt` field directly (neither carries a `rich_text`
 * sibling — `prompt` IS its printed text, `blocks.mjs`'s `short_answer` AND
 * `essay` validators both require exactly this field, same name on both).
 */
function firstPromptText(block) {
  if (block.type === 'short_answer' || block.type === 'essay') {
    return typeof block.prompt === 'string' ? block.prompt : null;
  }
  for (const child of block.blocks ?? []) {
    if (child?.type === 'rich_text' && typeof child.md === 'string') return child.md;
    if (child?.type === 'short_answer' && typeof child.prompt === 'string') return child.prompt;
  }
  return null;
}

/**
 * Pushes a `short_answer`/`essay` write-on entry for `block` (already
 * type-checked by the caller) onto `items`, using `positionalId` as the
 * fallback when the block carries no `itemRef` of its own.
 */
function pushWriteOn(items, block, positionalId) {
  items.push({ itemId: block.itemRef ?? positionalId, prompt: firstPromptText(block) ?? null });
}

/**
 * Write-ons (spec §5.3's "write-on blocks are worksheet-only or unscored"):
 * top-level blocks of the PREPARED document that `planRows` did NOT turn
 * into a card row, PLUS `short_answer`/`essay` write-ons nested one level
 * inside a top-level `inset` (an inset is legal write-on furniture —
 * `blocks.mjs`'s `INSET_UNSUPPORTED_CHILD_TYPES` deliberately leaves
 * `short_answer`/`essay` off its ban list, "nesting costs the box path
 * nothing new" — so a card that prints one must still queue it here; before
 * this fix an inset-wrapped write-on printed on the page but was invisible
 * to `unscannedItems`, so a session could grade "complete" with it still
 * unread). Shapes reach here:
 *   - a top-level `question` block whose `itemId` isn't among `plan.rows`'
 *     itemIds (unscored, or an explicit `points: 0` override) — complement
 *     of exactly the set `planRows` selected, never a re-derived guess at
 *     block shape (F4-style drift risk `planRows` itself already fences off).
 *   - a standalone `short_answer` sugar block (spec §4.2/§6.2) — NEVER
 *     row-mapped regardless of whether it minted an answer-key item
 *     (`RenderPrintDocument.mjs`'s own `collectAnswerKeyEntries` comment:
 *     "it's a write-on aside, never card-mapped"), so it unconditionally
 *     counts here.
 *   - a standalone `essay` sugar block (spec §4.2/§6.2) — structurally the
 *     same write-on as `short_answer` for this purpose (`blocks.mjs`: no
 *     `itemId`, NEVER carries an answer at all — "unmarked prose has nothing
 *     for a bank to hold"), so it is never row-mapped either and gets the
 *     same treatment.
 *   - either of the above nested one level inside a top-level `inset`'s own
 *     `blocks` array — same treatment, one level deep only (insets can't
 *     nest insets — `blocks.mjs`).
 *   `short_answer`/`essay` carry no author-assigned id
 *   (`documentSource.mjs`'s keyless-item scheme is a PUBLISH-time-only
 *   concern, and `essay` never mints a bank item at all); `itemRef` is used
 *   when present (a `short_answer` authored with an answer), else a
 *   positional fallback mirroring `blockIndexFromPath`'s own `blocks[N]`
 *   notation elsewhere in this file — `blocks[N].blocks[M]` for an
 *   inset-nested one — good enough for a diagnostic label, never fed back
 *   into grading.
 */
function unscannedItemsFor(prepared, rowItemIds) {
  const items = [];
  (prepared.blocks ?? []).forEach((block, index) => {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'question' && !rowItemIds.has(block.itemId)) {
      items.push({ itemId: block.itemId ?? `blocks[${index}]`, prompt: firstPromptText(block) ?? null });
      return;
    }
    if (block.type === 'short_answer' || block.type === 'essay') {
      pushWriteOn(items, block, `blocks[${index}]`);
      return;
    }
    if (block.type === 'inset') {
      (block.blocks ?? []).forEach((child, childIndex) => {
        if (!child || typeof child !== 'object') return;
        if (child.type === 'short_answer' || child.type === 'essay') {
          pushWriteOn(items, child, `blocks[${index}].blocks[${childIndex}]`);
        }
      });
    }
  });
  return items;
}

/**
 * A given letter -> the bank item's actual choice value at that position, or
 * `undefined` for an out-of-range letter (F6 review fix, Low: a nonexistent
 * bubble — a decoded letter past the item's own choice count — used to fall
 * all the way through to `given: undefined`, indistinguishable from a BLANK
 * row; `gradeRow` below now carries the raw letter forward instead, so an
 * impossible mark still grades `incorrect`/`ambiguous` with the actual
 * bubble the student marked visible in `given`, never silently treated as
 * unanswered).
 */
function letterToChoice(item, letter) {
  const index = LETTERS.indexOf(letter);
  return index === -1 ? undefined : item.choices?.[index];
}

/**
 * The exact inverse of `letterToChoice` above, against `item.answer` (spec
 * §5.4 eraser-leniency — `ambiguityLeniency.mjs`'s `creditsAsEraser` needs
 * the letter the answer key expects, not the choice VALUE `gradeRow` already
 * resolved `given` into). `true_false` has no `choices` array to invert
 * (spec §5.3's fixed Ⓐ True / Ⓑ False), so its two letters are hardcoded
 * against the boolean `item.answer` directly, mirroring `gradeAnswer`'s own
 * A='true'/B='false' mapping. Returns `null` — never a guess — when the
 * letter can't be derived (an item with no `choices` array and not
 * `true_false`, or an `answer` that isn't actually among `choices`, both
 * refused elsewhere but defended here too since this function has no
 * business assuming the input is already clean).
 */
function correctLetterFor(item) {
  if (item.type === 'true_false') {
    if (item.answer === true) return 'A';
    if (item.answer === false) return 'B';
    return null;
  }
  if (!Array.isArray(item.choices)) return null;
  const index = item.choices.indexOf(item.answer);
  return index === -1 ? null : (LETTERS[index] ?? null);
}

/**
 * Promotes eraser-signature `ambiguous` rows to `correct`, cheapest-
 * explanation first and capped per sheet (spec §5.4 eraser-leniency policy,
 * 2026-08-22). Runs AFTER per-row grading (`gradeRow` stays a pure per-row
 * function with no sheet-level knowledge) because the cap is a property of
 * the SHEET — this record's own row count — not any one row.
 *
 * `rowContext` carries `{item, choiceCount}` for exactly the rows `gradeRow`
 * marked `ambiguous` (built by the caller from data already resolved while
 * grading — never re-fetched here). Rule 5 (deterministic cap spend) is
 * explicit: rows are walked in ascending `row` order regardless of the
 * incoming array's order, so the earliest questions always get first claim
 * on the budget. A row that is not eligible, or is eligible but the budget
 * is already spent, is returned completely untouched — same object,
 * same status — so a non-lenient archetype (cap 0) or an ineligible row
 * never has its shape perturbed by this pass at all.
 */
function applyLeniency({
  results, archetype, rowContext, logger,
}) {
  let budget = leniencyCap({ archetype, rowCount: results.length });
  if (budget <= 0) return results;

  const promotedRows = new Set();
  const byQuestionNumber = [...results].sort((a, b) => a.row - b.row);
  for (const row of byQuestionNumber) {
    if (budget <= 0) break;
    if (row.status !== 'ambiguous') continue;
    const context = rowContext.get(row.row);
    if (!context) continue;
    const correctLetter = correctLetterFor(context.item);
    const eligible = creditsAsEraser({
      item: { choiceCount: context.choiceCount }, given: row.given, correctLetter,
    });
    if (!eligible) continue;
    promotedRows.add(row.row);
    budget -= 1;
    logger?.info?.('school.print.scan-leniency-applied', {
      itemId: row.itemId, row: row.row, given: row.given, correctLetter, remainingBudget: budget,
    });
  }
  if (promotedRows.size === 0) return results;

  return results.map((row) => (promotedRows.has(row.row)
    ? {
      ...row, status: 'correct', earned: row.points, leniency: 'eraser',
    }
    : row));
}

/**
 * The gate row's four-way verdict (Task 10, extended Task 11).
 *
 * `exhausted` is the one that is not about the code at all — it is about the
 * PAPER. A child repairs a wrong finish code by filling in more bubbles and
 * feeding the same sheet again, which walks a chain of supersets (A, AB, ABC,
 * ...) because a mark cannot be taken back. Every bubble filled and still
 * wrong means there is no mark left to add: this sheet's gate can never clear,
 * and the receipt has to say "ask for a new sheet" rather than "check the
 * letters and scan this again", which is advice that cannot work.
 *
 * Read off the marks, not off a counter: the physics IS the bound, so nothing
 * has to remember how many times the card went through the roller.
 *
 * @param {{status: string, given: *}} gateRow - the graded gate row
 * @returns {'satisfied'|'blank'|'wrong'|'exhausted'}
 */
function gateVerdict(gateRow) {
  if (gateRow.status === 'correct') return GATE_SATISFIED;
  if (gateRow.status === 'blank') return GATE_BLANK;
  const marks = new Set(Array.isArray(gateRow.given) ? gateRow.given : [gateRow.given]);
  return CODE_LETTERS.every((letter) => marks.has(letter)) ? GATE_EXHAUSTED : GATE_WRONG;
}

/**
 * Row->item mapping drift (F4 review fix — "bank-select scan integrity vs
 * mutable external banks"): true when ANY of `record.rowItems`'s OWNED-row
 * entries disagrees with what `planRows` just re-derived for that same row —
 * a different `itemId` (a bank-select block resolved a DIFFERENT item because
 * the external bank's item count/order changed since the card was printed)
 * or a different `itemType` (same id, but the bank now describes it
 * differently — still not what the paper carries). Checked only over
 * `ownedRows` (never the record's full persisted range) — a row this record
 * no longer owns (lost to a newer claimant, `resolveRowOwners`) is not graded
 * by this record either way, so a mutated mapping on THAT row is moot here.
 */
function rowMappingDrifted(recordedRowItems, rederivedRows, ownedRows) {
  const rederivedByRow = new Map(rederivedRows.map((row) => [row.row, row]));
  return recordedRowItems
    .filter((entry) => ownedRows.includes(entry.row))
    .some((entry) => {
      const rederived = rederivedByRow.get(entry.row);
      return !rederived || rederived.itemId !== entry.itemId || rederived.itemType !== entry.itemType;
    });
}

/**
 * Grades one row (spec §5.4's "the resolver receives per-row item type ...
 * distinguishes a double-mark on a single-select row (ambiguous, existing
 * legacy semantics) from a multi-select answer (legal mask)", §5.5's
 * multi_select exact-set rule). `given` is `undefined` for a row with no
 * entry at all in the decoded `answers` (spec §5.4 "unanswered rows in
 * range ⇒ blank").
 */
function gradeRow(item, given, points) {
  if (given === undefined) {
    return {
      status: 'blank', given: null, points, earned: 0,
    };
  }

  // THE COMPANION GATE ROW (Task 10). ABOVE the `Array.isArray(given)` guard
  // below, and that placement is the whole fix: a decoded gate row IS an array
  // of letters, so before this branch existed every gate — right or wrong —
  // fell into that guard, graded `ambiguous`, and never reached `gradeAnswer`
  // at all. No sheet could fail its gate, and the symptom (a sheet stuck in
  // review) read like a scanner fault rather than a path nobody had written.
  //
  // Its letters ARE its choices (A-E), so there is no `letterToChoice`
  // indirection: `gradeAnswer` compares the marked letters to `item.code`
  // through `codesMatch`. `earned: 0` unconditionally — the gate is a VETO,
  // not a question, and it can never move the score in either direction
  // (`points` is already 0 from the block's own `points: 0`, stated again here
  // so a future points default can never accidentally pay it out).
  //
  // `{ correct }` ALONE, never `expected`. `gradeAnswer` returns
  // `{correct, expected}` and for THIS item type `expected` is the finish code
  // itself; this function's return value travels out through `execute` to a
  // browser, so destructuring it here would hand a child the answer without
  // their ever playing the companion.
  if (item.type === 'companion_code') {
    const letters = Array.isArray(given) ? given : [given];
    const { correct } = gradeAnswer(item, letters);
    return {
      status: correct ? 'correct' : 'incorrect', given: letters, points, earned: 0,
    };
  }

  if (item.type === 'multi_select') {
    // Both a single letter (one mark) and an array (several marks) are legal
    // shapes for a multi_select row — normalise to the set gradeAnswer wants.
    const letters = Array.isArray(given) ? given : [given];
    const values = letters.map((letter) => letterToChoice(item, letter));
    const { correct } = gradeAnswer(item, values);
    return {
      status: correct ? 'correct' : 'incorrect', given: values, points, earned: correct ? points : 0,
    };
  }

  // multiple_choice / true_false: single-select. `gradeRow` itself never
  // guesses at a double-mark — it stays a pure per-row function with no
  // sheet-level knowledge (spec §5.4) — so every multi-mark single-select
  // row grades `ambiguous` here, unconditionally. Bounded eraser-leniency
  // (spec §5.4, 2026-08-22 policy: two marks, one correct, not every choice
  // covered, capped per sheet) is a SEPARATE second pass over the whole
  // sheet's results — see `applyLeniency` below, run by `#resolveRecord`
  // AFTER every row here has been graded.
  if (Array.isArray(given)) {
    return {
      status: 'ambiguous', given, points, earned: 0,
    };
  }

  if (item.type === 'true_false') {
    // gradeAnswer already accepts the raw 'A'/'B' letter directly (spec §5.3's
    // Ⓐ True / Ⓑ False card rendering) — no choices array to resolve through.
    const { correct } = gradeAnswer(item, given);
    return {
      status: correct ? 'correct' : 'incorrect', given, points, earned: correct ? points : 0,
    };
  }

  const value = letterToChoice(item, given);
  const { correct } = gradeAnswer(item, value);
  return {
    // F6 review fix, Low: a nonexistent bubble (a decoded letter past this
    // item's own choice count — `letterToChoice` returns `undefined`) still
    // grades `incorrect` (never guessed correct — `gradeAnswer(item,
    // undefined)` can only ever equal a real `item.answer` by coincidence,
    // which it never does), but `given` now carries the RAW LETTER the
    // student actually marked instead of silently reporting `undefined`,
    // which was indistinguishable from a blank/unanswered row.
    status: correct ? 'correct' : 'incorrect',
    given: value !== undefined ? value : given,
    points,
    earned: correct ? points : 0,
  };
}

export class ResolveCardScan {
  #allocationStore; #repository; #banks; #logger; #heldScanStore; #protectionMode;

  /**
   * @param {object} deps
   * @param {{findByCard: Function, updateStatus: Function, listCardIds?: Function}} deps.allocationStore -
   *   `YamlAllocationStore`-shaped. `listCardIds` is OPTIONAL-DEGRADING —
   *   absent (an older fake), best-effort ambiguous-id resolution simply
   *   never runs (see `execute`'s own guard) rather than crashing; every
   *   other behavior is unchanged.
   * @param {{getPublished: Function, getDerivedBank?: Function}} deps.repository -
   *   `YamlPrintDocumentRepository`-shaped.
   * @param {{getBank: (id: string) => (object|null)}} [deps.banks] - bank-select
   *   sugar reader (spec §6.2) — same shape `RenderPrintDocument` takes, and
   *   MUST be the same content root the original render used, or a
   *   bank-select-bearing document will re-derive a different row mapping.
   * @param {object} [deps.logger] - same DI-with-console-default convention
   *   as every other use case in this codebase (`RenderPrintDocument`,
   *   `ResolveScanAction`, `quizScanRecorder`) — an inferred card id (see
   *   `#resolveTestId` below) must be LOUD (household direction: "the
   *   resolution must be visible, not silently substituted"), so this class
   *   now needs somewhere to say so even when no caller wires one explicitly.
   */
  constructor({
    allocationStore, repository, banks = null, heldScanStore = null,
    protectionMode = 'off', logger = console,
  } = {}) {
    if (!allocationStore) throw new Error('ResolveCardScan requires allocationStore');
    if (!repository) throw new Error('ResolveCardScan requires repository');
    this.#allocationStore = allocationStore;
    this.#repository = repository;
    this.#banks = banks;
    if (!['off', 'shadow', 'enforce'].includes(protectionMode)) {
      throw new Error(`ResolveCardScan: unknown protectionMode '${protectionMode}'`);
    }
    this.#heldScanStore = heldScanStore;
    this.#protectionMode = protectionMode;
    this.#logger = logger;
  }

  /**
   * @param {{testId: string|null, testIdCandidates?: Array<number[]>,
   *   answers?: Record<number, string|string[]>}} args `testIdCandidates`
   *   (`quizScanRecorder.mjs`'s `decodeQuizSheet` output, present only when
   *   `testId` itself contains a `?`) is what makes best-effort resolution
   *   possible at all — see `#resolveTestId` below.
   * @returns {Promise<{error: {code: 'CARD_ID_UNREADABLE'}, ambiguous?: {pattern: string, candidateCardIds: string[]}}
   *   |{results: object[], unallocatedRows?: number[], cardIdInferred?: {pattern: string, cardId: string}}
   *   |{results: [], deadCard: true, answeredRowCount: number, recordStatuses: string[], cardIdInferred?: {pattern: string, cardId: string}}>}
   *   Each `results[]` entry is EITHER a graded result —
   *   `{cardId, recordId, documentId, rev, variant, learnerId?, renderedAt,
   *   revisionSuperseded, results: [{row, itemId, itemType, prompt,
   *   status, given, points, earned, concepts}], totalPoints, earnedPoints,
   *   unscannedItems: [{itemId, prompt}]}` (`prompt` is the resolved bank
   *   item's own prompt text, `null` when it has none; `concepts` is the
   *   resolved bank item's own optional `concepts` array (R2,
   *   questionBankValidation.mjs), empty when it has none; `companionGate`
   *   (Task 10) is
   *   `{itemId, row, status: 'satisfied'|'blank'|'wrong'|'exhausted', given}`
   *   on a GATED sheet only — the gate row is never inside `results`, because
   *   it is a veto rather than a question and belongs in no score, no attempt
   *   ledger and no review queue, and it never carries the expected finish
   *   code back out; `renderedAt` is
   *   the allocation record's own render timestamp; `unscannedItems` is
   *   the write-on questions/short_answer/essay sugar this record's own
   *   prepared document carries that consumed no card row — empty array
   *   when none) — OR, when the record's own persisted `rowItems` no longer
   *   matches what re-derivation just produced (F4, an external bank
   *   mutated after the card printed), a per-record error entry instead:
   *   `{cardId, recordId, documentId, rev, variant, learnerId?, error:
   *   {code: 'ALLOCATION_ROW_MAPPING_DRIFT'}}` — no
   *   `results`/`totalPoints`/`earnedPoints`/`unscannedItems`, and nothing
   *   in it is graded — OR, when `#resolveRecord` itself throws (a
   *   sabotaged/deleted published artifact behind this record's pinned rev,
   *   a phantom rev), an error entry with a DIFFERENT code carried through
   *   from the failure: `{cardId, recordId, documentId, rev, variant,
   *   learnerId?, error: {code, message}}` (`code` defaults to
   *   `'SCAN_RECORD_RESOLVE_FAILED'` when the thrown error carries none);
   *   every OTHER record on the same scan still resolves normally either way.
   *   `unallocatedRows` (answered rows that matched no live/satisfied
   *   allocation on this card) is present only when non-empty — never
   *   guessed at (spec §5.4).
   *   A card whose records EXIST but are ALL released/superseded (no
   *   live|satisfied claimant left), scanned with real answers, short-
   *   circuits to `{results: [], deadCard: true, answeredRowCount,
   *   recordStatuses}` instead of falling through to a bare
   *   `unallocatedRows` report — the whole card is dead, not just some rows.
   *   Diagnostics (each present only when applicable): a graded entry
   *   carries `reScored: true` when its record had already settled before
   *   this scan; top-level `silentLiveRecords` lists live records whose
   *   owned rows got zero marks while other rows were answered (wrong-rows
   *   signature); an unknown card with real answers returns
   *   `{results: [], unknownCard: true, answeredRowCount, nearMissCardIds}`
   *   instead of a bare empty result. `cardIdInferred: {pattern, cardId}`
   *   marks EVERY successful outcome (graded `results`, `deadCard`) whose
   *   card id was inferred rather than read cleanly (household direction:
   *   "the resolution must be visible, not silently substituted" — see
   *   `#resolveTestId`) — absent entirely on a clean read, so its mere
   *   presence is itself the tell. An ambiguous id that fails to resolve
   *   (zero or 2+ consistent cards) still refuses `CARD_ID_UNREADABLE`,
   *   with `ambiguous: {pattern, candidateCardIds}` describing why, for the
   *   same "never guess, always explain" reason `unknownCard`'s
   *   `nearMissCardIds` already exists.
   */
  async execute({ testId, testIdCandidates = null, answers = {}, identityReview = null } = {}) {
    if (testId == null) {
      return { error: { code: 'CARD_ID_UNREADABLE' } };
    }

    // MEASUREMENT, NOT POLICY (computed up front, before resolution is even
    // attempted, so it is available on EVERY path below including a total
    // resolution failure — see the `decode` build just below the ambiguous
    // return). "How often does the reader produce a partial read?" must be
    // answerable from `?`-count alone, independent of whether resolution
    // later succeeds.
    const decodePattern = String(testId);
    const decodeMissingDigits = (decodePattern.match(/\?/g) ?? []).length;

    // Best-effort resolution (household direction, real incident: a
    // double-marked test-id digit decoded `?`, matched no allocation, and a
    // fully-answered sheet silently vanished). Only reached when `testId`
    // itself carries a `?` — a clean id skips straight to `findByCard`,
    // byte-identical to this method's behavior before this feature existed.
    let cardId = testId;
    let cardIdInferred = null;
    if (String(testId).includes('?')) {
      const resolved = await this.#resolveTestId(testId, testIdCandidates);
      if (!resolved.cardId) {
        this.#logger.warn?.('school.scan.card-id-unresolved', {
          pattern: testId, candidateCardIds: resolved.candidates,
        });
        // TOTAL DECODE FAILURE — the highest-value case this measurement
        // exists to count (review fix, 2026-09-01): `cardId: null` records
        // "no card resolved" honestly rather than fabricating one. Omitting
        // `decode` here would make a future decode-gate policy systematically
        // undercount exactly the reads it most needs to see.
        const decode = {
          pattern: decodePattern, cardId: null, inferred: false, missingDigits: decodeMissingDigits,
        };
        this.#logger.info?.('school.scan.decode', decode);
        return {
          error: { code: 'CARD_ID_UNREADABLE' },
          ambiguous: { pattern: testId, candidateCardIds: resolved.candidates },
          decode,
        };
      }
      cardId = resolved.cardId;
      cardIdInferred = { pattern: testId, cardId };
      // LOUD, ON PURPOSE (household direction, verbatim: "the resolution
      // must be visible, not silently substituted"). `warn`, not `info` —
      // even a correctly inferred id is still a guess this system made on
      // the household's behalf, low-probability collision or not, and it
      // deserves a human's eyes at least once, the same way `reScored`
      // and `silentLiveRecords` earn a `warn` elsewhere in this file for
      // the same "a machine made a judgment call here" reason.
      this.#logger.warn?.('school.scan.card-id-inferred', { pattern: testId, cardId });
    }

    // MEASUREMENT, NOT POLICY. Recorded on every scan, clean or inferred, so
    // "how often does the reader produce a partial read?" is answerable. No
    // decode policy should be tuned from anecdote, and two scans is anecdote.
    const decode = {
      pattern: decodePattern,
      cardId,
      inferred: cardIdInferred !== null,
      missingDigits: decodeMissingDigits,
    };
    this.#logger.info?.('school.scan.decode', decode);

    const records = await this.#allocationStore.findByCard(cardId);
    const answeredRows = new Set(Object.keys(answers).map(Number));
    if (records.some((record) => record.cardRetiredAt) && answeredRows.size > 0) {
      return {
        results: [], deadCard: true, retiredCard: true,
        answeredRowCount: answeredRows.size,
        recordStatuses: records.map((record) => record.status),
        ...(cardIdInferred ? { cardIdInferred } : {}),
        decode,
      };
    }
    const preflight = identityReview ? null : await this.#identityPreflight({ cardId, answers, records });
    if (preflight) return { ...preflight, ...(cardIdInferred ? { cardIdInferred } : {}), decode };
    const live = records.filter((record) => record.status === 'live');
    // A reused card retains old marks in satisfied rows. While a new worksheet
    // is live, grade only that live allocation and ignore the settled rows.
    const ordinarilyEligible = live.length > 0
      ? live
      : records.filter((record) => isLiveOrSatisfied(record.status));
    const eligible = identityReview?.targetRecordId
      ? ordinarilyEligible.filter((record) => record.recordId === identityReview.targetRecordId)
      : ordinarilyEligible;

    // A card the store has NEVER seen, with real answers on it, is almost
    // always a mis-bubbled card id (7 student-transcribed digits, no check
    // digit) — the child did the work and the quiz would otherwise silently
    // vanish. Surface it as its own outcome, with the live cards one digit
    // away as candidates the teacher can act on. (Unreachable when
    // `cardIdInferred` is set: `#resolveTestId` only ever resolves to an id
    // `listCardIds` already knows has records.)
    if (records.length === 0 && answeredRows.size > 0) {
      return {
        results: [],
        unknownCard: true,
        answeredRowCount: answeredRows.size,
        nearMissCardIds: await this.#nearMissLiveCards(cardId),
        decode,
      };
    }

    // A card whose records EXIST but are all released/superseded (dead —
    // no live|satisfied claimant left at all), scanned WITH real answers:
    // never silence. Distinct from `unknownCard` above (which fires on ZERO
    // records) — this is a card the store once knew, whose printed key(s)
    // have since been fully retired, so every mark it carries needs a
    // human's attention rather than vanishing into an empty `results: []`.
    if (eligible.length === 0 && records.length > 0 && answeredRows.size > 0) {
      return {
        results: [],
        deadCard: true,
        answeredRowCount: answeredRows.size,
        recordStatuses: records.map((record) => record.status),
        ...(cardIdInferred ? { cardIdInferred } : {}),
        decode,
      };
    }

    // Newest-claimant-wins row ownership (spec §5.4 review fix, CRITICAL —
    // see `resolveRowOwners`'s own doc comment): resolved ONCE, up front,
    // over every eligible record on the card, never per-record — a record's
    // own idea of "my range" is no longer authoritative once a newer record
    // has reclaimed part of it.
    const rowOwners = resolveRowOwners(eligible);
    const results = [];
    // LIVE records whose owned rows received zero marks while OTHER rows on
    // the same physical card were answered — the wrong-rows signature (Learner-Four
    // answered quiz B's questions in quiz A's rows). Undetectable in
    // principle from marks alone, so it is surfaced as a confidence signal
    // for the teacher, never guessed at or auto-corrected.
    const silentLiveRecords = [];

    for (const record of eligible) {
      const ownedRows = rowsInRange(record.rowRange).filter((row) => rowOwners.get(row) === record);
      // A record that owns none of the rows actually marked this scan is
      // omitted from `results` entirely (spec §5.4 review fix) — it lost
      // every marked row to a newer claimant, so reporting it (blank, against
      // a stale answer key, or both) would be exactly the double-grading /
      // phantom-result risk this rule exists to close off.
      if (!ownedRows.some((row) => answeredRows.has(row))) {
        // `answeredRows.size > 0` used to gate this (the "wrong-rows
        // signature": marks on the card, none in this record's rows). A
        // COMPLETELY blank card is the same fact with a smaller sample — the
        // live record got nothing — and it is the case where naming the rows
        // helps most, because the child has not started. Dropping the clause
        // routes both into the same `scan-rows-unmarked` ceremony.
        if (record.status === 'live' && ownedRows.length > 0) {
          silentLiveRecords.push({
            recordId: record.recordId,
            documentId: record.documentId,
            rowRange: { ...record.rowRange },
            ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
          });
        }
        continue;
      }

      // A per-record throw (e.g. the published artifact/derived bank behind
      // this record's PINNED rev is gone — a phantom rev, a deleted
      // artifact) no longer aborts the whole scan (resilience fix): it
      // becomes an error entry for THIS record only, and every OTHER
      // record on the same card still resolves and grades normally.
      let cardResult;
      try {
        // eslint-disable-next-line no-await-in-loop
        cardResult = await this.#resolveRecord(record, ownedRows, answers);
      } catch (err) {
        cardResult = {
          cardId: record.cardId,
          recordId: record.recordId,
          documentId: record.documentId,
          rev: record.rev,
          variant: record.variant,
          ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
          error: { code: err.code ?? 'SCAN_RECORD_RESOLVE_FAILED', message: err.message },
        };
      }
      results.push(cardResult);

      // A drift-error entry (F4) carries no `results` at all — nothing was
      // graded, so there is nothing to mark satisfied either; the record
      // stays exactly as it was (still `live`, still scannable again once the
      // drift is resolved, e.g. the bank is restored or a fresh card issued).
      if (cardResult.error) continue;

      // Marked satisfied only when EVERY row this record OWNS was answered
      // this scan (spec §5.4: "partial coverage stays live") — and only from
      // `live`, mirroring the store's own legal-transition rule (a record
      // already `satisfied` needs no re-write on a later re-scan). Rows the
      // record no longer owns don't count against it either way.
      const fullyAnswered = cardResult.results.every((row) => row.status !== 'blank');
      if (record.status === 'live' && fullyAnswered) {
        // eslint-disable-next-line no-await-in-loop
        await this.#allocationStore.updateStatus({ cardId, recordId: record.recordId, status: 'satisfied' });
      }
    }

    // A row with no owner at all (no live|satisfied record's range ever
    // covered it — includes a `released`/`superseded` record's now-stale
    // rows, spec §5.4 review fix, Important) is unallocated, never guessed.
    const unallocatedRows = [...answeredRows].filter((row) => !rowOwners.has(row)).sort((a, b) => a - b);
    const outcome = {
      results,
      // IS THIS CARD ONE OF OURS? (2026-08-26) An empty `results` means two
      // completely different things, and the consumer cannot tell them apart
      // without this count: a legacy household bubble sheet this system never
      // issued (zero records — silence is correct, the recorder already has
      // the decoded scan), or a print-document card we DID issue whose rows
      // simply did not line up with the marks (records exist — silence is the
      // failure that let four fed sheets vanish). Always present, so `?? 0`
      // in a consumer degrades to the safe, pre-existing "stay quiet" reading.
      cardRecordCount: records.length,
      ...(unallocatedRows.length ? { unallocatedRows } : {}),
      ...(silentLiveRecords.length ? { silentLiveRecords } : {}),
      ...(cardIdInferred ? { cardIdInferred } : {}),
      decode,
    };
    if (!identityReview) await this.#rememberProcessedScan({ cardId, answers, records, outcome });
    return outcome;
  }

  async #identityPreflight({ cardId, answers, records }) {
    if (this.#protectionMode === 'off' || !this.#heldScanStore) return null;
    const fingerprint = scanFingerprint(cardId, answers);
    const prior = await this.#heldScanStore.findByFingerprint(fingerprint);
    if (this.#protectionMode === 'enforce' && prior
        && (prior.state === 'held' || prior.state === 'seen')) {
      this.#logger.info?.('school.scan.identity-duplicate', {
        cardId, fingerprint, priorState: prior.state, heldScanId: prior.heldScanId,
      });
      return {
        results: [], duplicate: true, fingerprint,
        ...(prior.state === 'held' ? { held: true, heldScanId: prior.heldScanId, reason: prior.evidence.reason } : {}),
      };
    }

    const learnerIds = [...new Set(records.map((record) => record.learnerId).filter(Boolean))];
    if (learnerIds.length !== 1
        || typeof this.#allocationStore.findDeliveredLiveByLearner !== 'function') return null;
    const learnerId = learnerIds[0];
    const deliveredLive = await this.#allocationStore.findDeliveredLiveByLearner(learnerId);
    const activeCardIds = [...new Set(deliveredLive.map((record) => record.cardId))];
    const historical = records.some((record) => typeof record.successorCardId === 'string')
      || deliveredLive.some((record) => record.predecessorCardId === cardId);
    const reason = activeCardIds.length > 1
      ? 'multiple-delivered-live-answer-sheets'
      : historical ? 'activity-on-historical-answer-sheet' : null;
    if (!reason) return null;

    // Include the scanned card's own still-gradeable historical allocations
    // alongside every delivered live allocation. A historical-card hold must
    // show the adult what was actually on that card, not only its successor.
    const candidateRecords = new Map();
    for (const record of [
      ...records.filter((entry) => entry.learnerId === learnerId && isLiveOrSatisfied(entry.status)),
      ...deliveredLive,
    ]) {
      candidateRecords.set(`${record.cardId}:${record.recordId}`, record);
    }
    const candidates = [...candidateRecords.values()].map((record) => ({
      cardId: record.cardId,
      recordId: record.recordId,
      documentId: record.documentId,
      rev: record.rev,
      sessionId: record.sessionId ?? null,
      rowRange: { ...record.rowRange },
      renderedAt: record.renderedAt,
      deliveryState: record.deliveryState ?? null,
      deliveredAt: record.deliveredAt ?? null,
      generation: record.generation ?? null,
      predecessorCardId: record.predecessorCardId ?? null,
      successorCardId: record.successorCardId ?? null,
      identiconVersion: record.identiconVersion ?? null,
      scannedCardMatch: record.cardId === cardId,
      itemTypes: Array.isArray(record.rowItems) ? rowsInRange(record.rowRange).map((row) => (
        record.rowItems.find((item) => item.row === row)?.itemType ?? null
      )) : null,
      markedRowOverlap: Object.keys(answers).map(Number).filter((row) => (
        row >= record.rowRange.start && row <= record.rowRange.end
      )).length,
    })).sort((left, right) => (
      Number(right.scannedCardMatch) - Number(left.scannedCardMatch)
        || right.markedRowOverlap - left.markedRowOverlap
        || String(right.renderedAt).localeCompare(String(left.renderedAt))
    )).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    const evidence = {
      reason,
      learnerId,
      rawCardId: cardId,
      rawRows: canonicalAnswerRows(answers),
      decodedAnswers: structuredClone(answers),
      candidateWorksheets: candidates,
      activeCardIds,
    };
    const state = this.#protectionMode === 'enforce' ? 'held' : 'shadow';
    const persisted = await this.#heldScanStore.record({ fingerprint, state, evidence });
    this.#logger.warn?.(state === 'held' ? 'school.scan.identity-held' : 'school.scan.identity-shadow-match', {
      heldScanId: persisted.record.heldScanId,
      fingerprint,
      learnerId,
      cardId,
      activeCardIds,
      reason,
      candidateRecordIds: candidates.map((candidate) => candidate.recordId),
    });
    if (state === 'shadow') return null;
    return {
      results: [],
      held: true,
      heldScanId: persisted.record.heldScanId,
      fingerprint,
      reason,
      learnerId,
      activeCardIds,
      candidateWorksheets: candidates,
      message: 'Two answer sheets are active. Ask a grown-up to check this scan.',
    };
  }

  async #rememberProcessedScan({ cardId, answers, records, outcome }) {
    if (this.#protectionMode !== 'enforce' || !this.#heldScanStore) return;
    const fingerprint = scanFingerprint(cardId, answers);
    await this.#heldScanStore.record({
      fingerprint,
      state: 'seen',
      evidence: {
        reason: 'processed',
        rawCardId: cardId,
        rawRows: canonicalAnswerRows(answers),
        decodedAnswers: structuredClone(answers),
        learnerIds: [...new Set(records.map((record) => record.learnerId).filter(Boolean))],
        resultRecordIds: (outcome.results ?? []).map((result) => result.recordId),
      },
    });
  }

  /**
   * Best-effort resolution of a `?`-bearing `testId` against every card id
   * the store currently has ANY record for (`listCardIds` — live, satisfied,
   * released, superseded alike; the domain matcher only decides "which
   * printed card is this", not "is it still usable" — that's `execute`'s
   * own `findByCard`/`eligible` filtering right after this returns, exactly
   * as it already was for a cleanly-read id). Delegates the actual
   * consistency check to `resolveAmbiguousCardId` (`allocation.mjs`) —
   * matching invariants are a domain concern, this method is just the I/O
   * (listing the known ids) the pure function needs handed to it.
   *
   * `listCardIds` is OPTIONAL-DEGRADING (see constructor doc): a store
   * without it (an older test fake, or a future store shape) can never
   * attempt resolution, so this returns "no candidates" immediately rather
   * than throwing — the caller's existing `CARD_ID_UNREADABLE` refusal is
   * exactly right for that case too.
   */
  async #resolveTestId(testId, testIdCandidates) {
    if (typeof this.#allocationStore.listCardIds !== 'function') return { candidates: [] };
    const knownCardIds = await this.#allocationStore.listCardIds();
    return resolveAmbiguousCardId(testId, testIdCandidates, knownCardIds);
  }

  /**
   * Live cards exactly one digit off from `testId` (Hamming distance 1 over
   * the 7 digits) — the dominant transcription error for a student-bubbled
   * card id with no check digit. Household-scale linear scan; a store
   * without `listCardIds` (older fakes) simply yields no suggestions.
   */
  async #nearMissLiveCards(testId) {
    if (typeof this.#allocationStore.listCardIds !== 'function') return [];
    const nearMisses = [];
    for (const candidate of await this.#allocationStore.listCardIds()) {
      if (candidate.length !== testId.length) continue;
      let distance = 0;
      for (let i = 0; i < candidate.length && distance < 2; i += 1) {
        if (candidate[i] !== testId[i]) distance += 1;
      }
      if (distance !== 1) continue;
      // eslint-disable-next-line no-await-in-loop
      const records = await this.#allocationStore.findByCard(candidate);
      if (records.some((record) => record.status === 'live')) nearMisses.push(candidate);
    }
    return nearMisses.sort();
  }

  /**
   * Resolves one allocation record's document/bank at its PINNED rev, then
   * re-derives the row->item mapping via the same seam a card-attached
   * render used (`prepareV2Document` + `mergeBank` + `planRows`), and grades
   * every row in `ownedRows` — the subset of the record's own range it still
   * OWNS after row-ownership resolution (spec §5.4 review fix; may be the
   * full range, the common case with no row reuse in play).
   */
  async #resolveRecord(record, ownedRows, answers) {
    const pinnedDocument = await this.#repository.getPublished(record.documentId, record.rev);
    if (!pinnedDocument) {
      throw new EntityNotFoundError('PublishedDocument', `${record.documentId}@${record.rev}`, {
        details: { recordId: record.recordId, cardId: record.cardId },
      });
    }
    const baseBank = typeof this.#repository.getDerivedBank === 'function'
      ? ((await this.#repository.getDerivedBank(record.documentId, record.rev)) ?? null)
      : null;

    // PIN THE RECORD'S OWN RENDER CONTEXT (F1 review fix, Critical): the
    // published artifact `getPublished` returns carries whatever variant it
    // was PUBLISHED with — not necessarily the variant the render this record
    // came from actually used. `IssueDocument#execute`/`#issuePrintDocument`
    // both override `variant` in-memory per render (`state.variant === (doc.variant
    // ?? 0) ? doc : {...doc, variant: state.variant}`, never persisted back to
    // the published artifact) so a retry sheet can carry a DIFFERENT shuffle
    // than whatever the document happens to be published with. The allocation
    // record is the one durable place that override survives (`record.variant`,
    // written by `RenderPrintDocument#allocateCard` from the SAME overridden
    // document `IssueDocument` handed it) — re-deriving against the published
    // artifact's own variant instead would grade a variant-1 sheet against
    // variant-0's bank-select/shuffle mapping. `seed` is never overridden
    // anywhere in this codebase (only `variant` is), so `pinnedDocument.seed`
    // already matches `record.seed` by construction — pinned here too anyway,
    // defensively, since a mismatch would silently re-derive the wrong
    // shuffle exactly like a variant mismatch would.
    const { document: prepared, extraItems } = prepareV2Document(
      { ...pinnedDocument, variant: record.variant, seed: record.seed },
      { banks: this.#banks },
    );
    const bank = mergeBank(baseBank, extraItems, prepared.id);
    const bankItemsById = new Map((bank?.items ?? []).map((item) => [item.id, item]));

    const plan = planRows({ document: prepared, bank, startRow: record.rowRange.start });
    if (plan.errors) {
      throw new DomainInvariantError(
        `ResolveCardScan: could not re-derive row mapping for allocation record '${record.recordId}': `
          + plan.errors.join('; '),
        { code: 'SCAN_ROW_PLAN_INVALID', details: { recordId: record.recordId, errors: plan.errors } },
      );
    }

    // FAIL CLOSED ON ROW-MAPPING DRIFT (F4 review fix — "bank-select scan
    // integrity vs mutable external banks"): a record allocated after this
    // fix shipped carries `rowItems`, the mapping ACTUALLY printed. If the
    // external bank has since gained/lost/reordered items, re-deriving via
    // `planRows` above can silently resolve a DIFFERENT item than what the
    // physical card carries for a bank-select block (its selection formula
    // depends on `bank.items.length` — see `resolveBankSelect`,
    // `RenderPrintDocument.mjs`). Rather than grade against a mapping the
    // paper doesn't actually have, this record is refused outright — no
    // partial credit for the rows that DO still match, because a bank
    // mutation is a document-wide event, not a per-row one, and partial
    // trust here is exactly the drift risk this whole check exists to close.
    // A record with no `rowItems` (allocated before this field existed)
    // keeps the prior trust-the-re-derivation behavior unchanged.
    if (Array.isArray(record.rowItems) && rowMappingDrifted(record.rowItems, plan.rows, ownedRows)) {
      return {
        cardId: record.cardId,
        recordId: record.recordId,
        documentId: record.documentId,
        rev: record.rev,
        variant: record.variant,
        ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
        error: { code: 'ALLOCATION_ROW_MAPPING_DRIFT' },
      };
    }

    // The RECORDED mapping, when present, is AUTHORITATIVE for row->item
    // resolution (F4) — sourced from `record.rowItems` rather than the fresh
    // `plan.rows` re-derivation once the drift check above has already
    // confirmed the two agree row-for-row; `blockPath` (for `pointsForRow`)
    // still comes from `plan.rows`, since it is pure document-structure
    // (the select block's own slot position), never bank-content-dependent,
    // so it cannot itself drift the way an item selection can.
    const recordedItemIdByRow = Array.isArray(record.rowItems)
      ? new Map(record.rowItems.map((entry) => [entry.row, entry.itemId]))
      : null;

    // Rows `gradeRow` marked `ambiguous` stash their bank item + choiceCount
    // here as they're graded — the exact (and only) data `applyLeniency`
    // below needs to test the eraser signature, never re-fetched.
    const rowContext = new Map();
    const rawRowResults = plan.rows
      .filter((planned) => ownedRows.includes(planned.row))
      .map((planned) => {
        const itemId = recordedItemIdByRow?.get(planned.row) ?? planned.itemId;
        const item = bankItemsById.get(itemId);
        if (!item) {
          throw new EntityNotFoundError('BankItem', itemId, {
            details: { recordId: record.recordId, row: planned.row },
          });
        }
        const points = pointsForRow(prepared, planned.blockPath);
        const graded = gradeRow(item, answers[planned.row], points);
        if (graded.status === 'ambiguous') {
          rowContext.set(planned.row, { item, choiceCount: planned.choiceCount });
        }
        return {
          row: planned.row,
          itemId,
          itemType: item.type,
          prompt: item.prompt ?? null,
          ...graded,
          // Curriculum spine (R2): the bank item's own optional `concepts`
          // (questionBankValidation.mjs:57-61) rides the row result — empty
          // when the item defines none — so `RecordCardScanOutcome` can file
          // each attempt's `conceptIds` without re-reading the bank itself.
          concepts: item.concepts ?? [],
        };
      });

    // THE GATE LEAVES THROUGH ITS OWN DOOR (Task 10). Partitioned HERE, at
    // the one place both halves are in hand, rather than filtered again at
    // every consumer — `results` is what the whole downstream treats as "the
    // child's answers": the percent denominator and the attempt ledger
    // (`RecordCardScanOutcome`), `missedItemIds`, the review queue, the
    // section slices below, and `execute`'s own partial-coverage rule. The
    // gate belongs in none of them: it is worth no points, it is not the
    // child's work on this lesson, and folding it in would make a 10-of-10
    // sheet read 10/11 = 90.91%. One partition, so it cannot be forgotten in
    // four places independently.
    const gateRow = rawRowResults.find((row) => row.itemType === 'companion_code') ?? null;
    const questionRows = gateRow
      ? rawRowResults.filter((row) => row.itemType !== 'companion_code')
      : rawRowResults;
    // `status`, `row` and the child's own marks — never `item.code`. See
    // `gradeRow`'s companion_code branch: this object reaches a browser.
    const companionGate = gateRow
      ? {
        itemId: gateRow.itemId,
        row: gateRow.row,
        status: gateVerdict(gateRow),
        given: gateRow.given,
      }
      : null;

    // Bounded eraser-leniency (spec §5.4, 2026-08-22 policy): a second pass
    // over the freshly graded rows, because the per-sheet cap is a property
    // of THIS record's own row count, never a single row in isolation.
    // `prepared.archetype` (spec §4.1, `documentV2.mjs`'s `ARCHETYPES`) is
    // this record's own prepared document's archetype — the SAME field
    // `RenderPrintDocument.mjs` reads for header/duplex presets — so a
    // `worksheet` scan is graded lenient and a `quiz`/`infopage` scan stays
    // exactly as strict as it always was (cap 0, this pass is then a no-op
    // that returns `rawRowResults` untouched).
    // `questionRows`, NOT `rawRowResults`: the leniency budget is
    // `max(1, floor(rowCount / 5))`, so counting the gate as a row would buy a
    // nine-question worksheet a second free promotion. The gate is also never
    // itself promotable — `correctLetterFor` returns null for an item with no
    // `item.answer`, so `creditsAsEraser` refuses it — but relying on that
    // accident would leave the budget wrong, and rule 3 (marks covering every
    // choice never earn credit) would misread a legitimate all-five `ABCDE`
    // finish code besides. Keeping it out of the pass entirely settles both.
    const rowResults = applyLeniency({
      results: questionRows, archetype: prepared.archetype, rowContext, logger: this.#logger,
    });

    const totalPoints = rowResults.reduce((sum, row) => sum + row.points, 0);
    const earnedPoints = rowResults.reduce((sum, row) => sum + row.earned, 0);

    // Write-ons (spec §5.3): top-level blocks of THIS record's own prepared
    // document that consumed no card row at all — never re-derived per row,
    // computed once over the whole document (see `unscannedItemsFor`'s own
    // doc comment for the two shapes it recognises).
    const rowItemIds = new Set(plan.rows.map((planned) => planned.itemId));
    const unscannedItems = unscannedItemsFor(prepared, rowItemIds);
    // A composed print owns one physical card allocation, but each section
    // remains an independently gradeable lesson.  Preserve the normal
    // record-level result for card lifecycle decisions and attach immutable
    // section slices for the evidence/session bridge. Older allocations lack
    // `sections` and therefore retain their exact old result shape.
    const sections = Array.isArray(record.sections)
      ? record.sections.map((section) => {
        const results = rowResults.filter((row) => (
          row.row >= section.rowRange.start && row.row <= section.rowRange.end
        ));
        const totalPoints = results.reduce((sum, row) => sum + row.points, 0);
        const earnedPoints = results.reduce((sum, row) => sum + row.earned, 0);
        return {
          id: section.id,
          rowRange: { ...section.rowRange },
          ...(section.worksheetInstanceId ? { worksheetInstanceId: section.worksheetInstanceId } : {}),
          ...(section.sessionId ? { sessionId: section.sessionId } : {}),
          ...(section.lessonId ? { lessonId: section.lessonId } : {}),
          ...(section.subjectId ? { subjectId: section.subjectId } : {}),
          ...(section.courseId ? { courseId: section.courseId } : {}),
          results, totalPoints, earnedPoints,
        };
      }).filter((section) => section.results.length > 0)
      : [];

    return {
      cardId: record.cardId,
      recordId: record.recordId,
      documentId: record.documentId,
      rev: record.rev,
      variant: record.variant,
      ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
      ...(record.sessionId != null ? { sessionId: record.sessionId } : {}),
      // The allocation record's own render timestamp (Task 4 needs it to
      // place a scan attempt in time relative to when the card was printed).
      renderedAt: record.renderedAt,
      revisionSuperseded: await this.#isSuperseded(record),
      // The record had ALREADY settled before this scan arrived — a re-fed
      // card, or a different child bubbling this card's id. Grading still
      // happens (the marks are real), but the consumer must treat this as a
      // repeat, not a first submission (M4/idempotency: see
      // schoolPrintScanConsumer + the attempt store's own de-dup).
      ...(record.status === 'satisfied' ? { reScored: true } : {}),
      results: rowResults,
      totalPoints,
      earnedPoints,
      unscannedItems,
      // Present ONLY on a gated sheet — an ungated one is byte-identical to
      // what this method returned before the gate existed, which is the
      // regression that matters most: every worksheet in the house is ungated.
      ...(companionGate ? { companionGate } : {}),
      ...(sections.length ? { sections } : {}),
    };
  }

  /**
   * `revisionSuperseded` (spec §4.3): true when the repository's LATEST
   * published rev for this document differs from the rev the allocation
   * record pinned — "a scan resolving to a superseded rev is graded
   * normally and flagged revisionSuperseded for the teacher's awareness."
   */
  async #isSuperseded(record) {
    const latest = await this.#repository.getPublished(record.documentId);
    return !!latest && latest.rev !== record.rev;
  }
}

export default ResolveCardScan;
