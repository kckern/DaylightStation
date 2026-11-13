/**
 * IPrintedActivityStore — the issuance log for the printed-activity program:
 * every page printed for a child, and the scan that completed it.
 *
 * Records, not runtime: a completed sheet is evidence, so the log lives under
 * `school/records/` and is never pruned.
 *
 * The rules this store exists to serve (enforced by the caller, answered here):
 *   - a page id resolves to exactly one child, so a page is never OPEN (printed,
 *     not yet scanned) for two children at once — `findOpen` is that lookup;
 *   - a child never gets the same page twice in a corpus — `listForLearner`
 *     supplies the exclude set;
 *   - a scan completes the open issuance, credited on the study day of the scan
 *     — `complete` takes that day;
 *   - scanning twice must not count twice — `complete` answers `already` and
 *     writes nothing on a repeat.
 *
 *   - a learner holds at most ONE open issuance per corpus — `append` refuses a
 *     second (`CorpusAlreadyOpenError`, `code: 'CORPUS_ALREADY_OPEN'`, carrying
 *     the `held` issuance), so a double scan of the ticket becomes a reprint;
 *   - an issuance is a RESERVATION made before printing: if the print fails or
 *     is unconfirmed (a dry-run printer), the caller `void`s it. A voided row
 *     stays on record as evidence but is not open, never counts as completed,
 *     and is not "history" for the never-repeat rule (the child never got the
 *     page). `listForLearner` still returns voided rows; callers that build an
 *     exclude set skip rows with `voidedAt` set.
 *
 * Issuance: `{issuanceId, learnerId, programId, corpusId, platform, externalId,
 * title, kind, level, issuedAt, issuedStudyDay, completedAt, completedStudyDay,
 * completedVia, voidedAt, voidReason}`. Open means `completedAt == null` and
 * `voidedAt == null` (older rows without `voidedAt` read as not voided).
 *
 * CROSS-LEARNER LOOKUPS CAN BE PARTIAL. `listOpenAll`, `findOpen` and `findAny`
 * never throw; a learner whose record cannot be read contributes nothing, and
 * the implementation logs `school.printed-activity.lookup-partial` naming them.
 * `append` is the authority on "one open issuance per page": it re-checks
 * inside its own write and throws `PageAlreadyOpenError`
 * (`code: 'PAGE_ALREADY_OPEN'`), so a caller's pre-check is an optimisation.
 */
export class IPrintedActivityStore {
  /**
   * Record a newly printed page. Throws on a missing key field, an unsafe
   * learner id, an issuanceId already on record (`code: 'DUPLICATE_ISSUANCE_ID'`), or (`PAGE_ALREADY_OPEN`) a
   * page that is open for any learner, or (`CORPUS_ALREADY_OPEN`, with `held`)
   * a learner who already holds an open issuance in that corpus.
   * @param {object} issuance
   * @returns {Promise<object>} the stored issuance
   */
  async append() { throw new Error('IPrintedActivityStore.append must be implemented'); }

  /** @returns {Promise<object[]>} every issuance for the learner (voided included), oldest first; [] on any read problem */
  async listForLearner() { throw new Error('IPrintedActivityStore.listForLearner must be implemented'); }

  /** @returns {Promise<object[]>} every open issuance across all learners */
  async listOpenAll() { throw new Error('IPrintedActivityStore.listOpenAll must be implemented'); }

  /**
   * @param {{platform: string, externalId: string}} key
   * @returns {Promise<object|null>} the open issuance for that page, across learners
   */
  async findOpen() { throw new Error('IPrintedActivityStore.findOpen must be implemented'); }

  /**
   * @param {{platform: string, externalId: string}} key
   * @returns {Promise<object|null>} the most recently issued issuance for that page, any status (voided included)
   */
  async findAny() { throw new Error('IPrintedActivityStore.findAny must be implemented'); }

  /**
   * Mark an issuance done. IDEMPOTENT: a second scan of the same page answers
   * `already` with the issuance as first completed, and writes nothing. A
   * voided issuance answers `voided` and is never completed.
   * @param {string} learnerId
   * @param {string} issuanceId
   * @param {{at: string, studyDay: string, device: string|null}} completion
   * @returns {Promise<{status: 'completed'|'already'|'missing'|'voided', issuance: object|null}>}
   */
  async complete() { throw new Error('IPrintedActivityStore.complete must be implemented'); }

  /**
   * Release a reservation that never reached paper (print failed or was
   * unconfirmed). Marks `voidedAt`/`voidReason` and keeps the row. Refuses a
   * completed issuance (`completed`, no write); a repeat answers `already`.
   * @param {string} learnerId
   * @param {string} issuanceId
   * @param {{at: string, reason: string}} details
   * @returns {Promise<{status: 'voided'|'already'|'missing'|'completed', issuance: object|null}>}
   */
  async void() { throw new Error('IPrintedActivityStore.void must be implemented'); }

  /**
   * @returns {Promise<object[]>} the learner's issuances in `corpusId` whose
   *   `completedStudyDay === studyDay` (never a voided one)
   */
  async listCompletedForDay() { throw new Error('IPrintedActivityStore.listCompletedForDay must be implemented'); }
}

export default IPrintedActivityStore;
