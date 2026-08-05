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
import { planRows } from '#domains/school/documents/allocation.mjs';
import { gradeAnswer } from '#domains/school/grading.mjs';
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

/** A given letter -> the bank item's actual choice value at that position, or `undefined` for an out-of-range letter. */
function letterToChoice(item, letter) {
  const index = LETTERS.indexOf(letter);
  return index === -1 ? undefined : item.choices?.[index];
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

  // multiple_choice / true_false: single-select. A double-mark is ambiguous
  // regardless of what was marked — never guessed at (spec §5.4).
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
    status: correct ? 'correct' : 'incorrect', given: value, points, earned: correct ? points : 0,
  };
}

export class ResolveCardScan {
  #allocationStore; #repository; #banks;

  /**
   * @param {object} deps
   * @param {{findByCard: Function, updateStatus: Function}} deps.allocationStore -
   *   `YamlAllocationStore`-shaped.
   * @param {{getPublished: Function, getDerivedBank?: Function}} deps.repository -
   *   `YamlPrintDocumentRepository`-shaped.
   * @param {{getBank: (id: string) => (object|null)}} [deps.banks] - bank-select
   *   sugar reader (spec §6.2) — same shape `RenderPrintDocument` takes, and
   *   MUST be the same content root the original render used, or a
   *   bank-select-bearing document will re-derive a different row mapping.
   */
  constructor({ allocationStore, repository, banks = null } = {}) {
    if (!allocationStore) throw new Error('ResolveCardScan requires allocationStore');
    if (!repository) throw new Error('ResolveCardScan requires repository');
    this.#allocationStore = allocationStore;
    this.#repository = repository;
    this.#banks = banks;
  }

  /**
   * @param {{testId: string|null, answers?: Record<number, string|string[]>}} args
   * @returns {Promise<{error: {code: 'CARD_ID_UNREADABLE'}}
   *   |{results: object[], unallocatedRows?: number[]}>}
   *   Each `results[]` entry: `{cardId, recordId, documentId, rev, variant,
   *   learnerId?, revisionSuperseded, results: [{row, itemId, status, given,
   *   points, earned}], totalPoints, earnedPoints}`. `unallocatedRows`
   *   (answered rows that matched no live/satisfied allocation on this card)
   *   is present only when non-empty — never guessed at (spec §5.4).
   */
  async execute({ testId, answers = {} } = {}) {
    // testId null or containing '?' (any digit unreadable) — never guess
    // which card this was (spec §5.4).
    if (testId == null || String(testId).includes('?')) {
      return { error: { code: 'CARD_ID_UNREADABLE' } };
    }

    const records = await this.#allocationStore.findByCard(testId);
    const eligible = records.filter((record) => isLiveOrSatisfied(record.status));
    const answeredRows = new Set(Object.keys(answers).map(Number));

    // Newest-claimant-wins row ownership (spec §5.4 review fix, CRITICAL —
    // see `resolveRowOwners`'s own doc comment): resolved ONCE, up front,
    // over every eligible record on the card, never per-record — a record's
    // own idea of "my range" is no longer authoritative once a newer record
    // has reclaimed part of it.
    const rowOwners = resolveRowOwners(eligible);
    const results = [];

    for (const record of eligible) {
      const ownedRows = rowsInRange(record.rowRange).filter((row) => rowOwners.get(row) === record);
      // A record that owns none of the rows actually marked this scan is
      // omitted from `results` entirely (spec §5.4 review fix) — it lost
      // every marked row to a newer claimant, so reporting it (blank, against
      // a stale answer key, or both) would be exactly the double-grading /
      // phantom-result risk this rule exists to close off.
      if (!ownedRows.some((row) => answeredRows.has(row))) continue;

      // eslint-disable-next-line no-await-in-loop
      const cardResult = await this.#resolveRecord(record, ownedRows, answers);
      results.push(cardResult);

      // Marked satisfied only when EVERY row this record OWNS was answered
      // this scan (spec §5.4: "partial coverage stays live") — and only from
      // `live`, mirroring the store's own legal-transition rule (a record
      // already `satisfied` needs no re-write on a later re-scan). Rows the
      // record no longer owns don't count against it either way.
      const fullyAnswered = cardResult.results.every((row) => row.status !== 'blank');
      if (record.status === 'live' && fullyAnswered) {
        // eslint-disable-next-line no-await-in-loop
        await this.#allocationStore.updateStatus({ cardId: testId, recordId: record.recordId, status: 'satisfied' });
      }
    }

    // A row with no owner at all (no live|satisfied record's range ever
    // covered it — includes a `released`/`superseded` record's now-stale
    // rows, spec §5.4 review fix, Important) is unallocated, never guessed.
    const unallocatedRows = [...answeredRows].filter((row) => !rowOwners.has(row)).sort((a, b) => a - b);
    return unallocatedRows.length ? { results, unallocatedRows } : { results };
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

    const { document: prepared, extraItems } = prepareV2Document(pinnedDocument, { banks: this.#banks });
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

    const rowResults = plan.rows
      .filter((planned) => ownedRows.includes(planned.row))
      .map((planned) => {
        const item = bankItemsById.get(planned.itemId);
        if (!item) {
          throw new EntityNotFoundError('BankItem', planned.itemId, {
            details: { recordId: record.recordId, row: planned.row },
          });
        }
        const points = pointsForRow(prepared, planned.blockPath);
        const graded = gradeRow(item, answers[planned.row], points);
        return { row: planned.row, itemId: planned.itemId, ...graded };
      });

    const totalPoints = rowResults.reduce((sum, row) => sum + row.points, 0);
    const earnedPoints = rowResults.reduce((sum, row) => sum + row.earned, 0);

    return {
      cardId: record.cardId,
      recordId: record.recordId,
      documentId: record.documentId,
      rev: record.rev,
      variant: record.variant,
      ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
      revisionSuperseded: await this.#isSuperseded(record),
      results: rowResults,
      totalPoints,
      earnedPoints,
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
