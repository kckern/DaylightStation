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
   *   Each `results[]` entry is EITHER a graded result —
   *   `{cardId, recordId, documentId, rev, variant, learnerId?,
   *   revisionSuperseded, results: [{row, itemId, status, given, points,
   *   earned}], totalPoints, earnedPoints}` — OR, when the record's own
   *   persisted `rowItems` no longer matches what re-derivation just produced
   *   (F4, an external bank mutated after the card printed), a per-record
   *   error entry instead: `{cardId, recordId, documentId, rev, variant,
   *   learnerId?, error: {code: 'ALLOCATION_ROW_MAPPING_DRIFT'}}` — no
   *   `results`/`totalPoints`/`earnedPoints`, and nothing in it is graded;
   *   every OTHER record on the same scan still resolves normally.
   *   `unallocatedRows` (answered rows that matched no live/satisfied
   *   allocation on this card) is present only when non-empty — never
   *   guessed at (spec §5.4).
   *   Diagnostics (each present only when applicable): a graded entry
   *   carries `reScored: true` when its record had already settled before
   *   this scan; top-level `silentLiveRecords` lists live records whose
   *   owned rows got zero marks while other rows were answered (wrong-rows
   *   signature); an unknown card with real answers returns
   *   `{results: [], unknownCard: true, answeredRowCount, nearMissCardIds}`
   *   instead of a bare empty result.
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

    // A card the store has NEVER seen, with real answers on it, is almost
    // always a mis-bubbled card id (7 student-transcribed digits, no check
    // digit) — the child did the work and the quiz would otherwise silently
    // vanish. Surface it as its own outcome, with the live cards one digit
    // away as candidates the teacher can act on.
    if (records.length === 0 && answeredRows.size > 0) {
      return {
        results: [],
        unknownCard: true,
        answeredRowCount: answeredRows.size,
        nearMissCardIds: await this.#nearMissLiveCards(testId),
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
    // the same physical card were answered — the wrong-rows signature (Felix
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
        if (record.status === 'live' && ownedRows.length > 0 && answeredRows.size > 0) {
          silentLiveRecords.push({
            recordId: record.recordId,
            documentId: record.documentId,
            rowRange: { ...record.rowRange },
            ...(record.learnerId != null ? { learnerId: record.learnerId } : {}),
          });
        }
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const cardResult = await this.#resolveRecord(record, ownedRows, answers);
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
        await this.#allocationStore.updateStatus({ cardId: testId, recordId: record.recordId, status: 'satisfied' });
      }
    }

    // A row with no owner at all (no live|satisfied record's range ever
    // covered it — includes a `released`/`superseded` record's now-stale
    // rows, spec §5.4 review fix, Important) is unallocated, never guessed.
    const unallocatedRows = [...answeredRows].filter((row) => !rowOwners.has(row)).sort((a, b) => a - b);
    return {
      results,
      ...(unallocatedRows.length ? { unallocatedRows } : {}),
      ...(silentLiveRecords.length ? { silentLiveRecords } : {}),
    };
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

    const rowResults = plan.rows
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
        return { row: planned.row, itemId, ...graded };
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
      // The record had ALREADY settled before this scan arrived — a re-fed
      // card, or a different child bubbling this card's id. Grading still
      // happens (the marks are real), but the consumer must treat this as a
      // repeat, not a first submission (M4/idempotency: see
      // schoolPrintScanConsumer + the attempt store's own de-dup).
      ...(record.status === 'satisfied' ? { reScored: true } : {}),
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
