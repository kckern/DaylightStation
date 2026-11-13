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
 *   - a page is never issued twice in the household, to the same child or a
 *     sibling, once it has reached paper — `listIssuedExternalIds` supplies the
 *     exclude set. Every copy of a page carries the same QR, so a re-issue
 *     would let an old copy's scan credit whoever holds the page now. A voided
 *     reservation never reached paper and stays eligible;
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
 * completedVia, voidedAt, voidReason, lastPrintedAt}`. `lastPrintedAt` is the
 * last time paper came out for it (`markPrinted`); older rows without it read
 * `issuedAt` instead. Open means `completedAt == null` and
 * `voidedAt == null` (older rows without `voidedAt` read as not voided).
 *
 * CROSS-LEARNER LOOKUPS CAN BE PARTIAL. `listOpenAll`, `listIssuedExternalIds`, `findOpen` and `findAny`
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
   * The household's never-repeat set for one platform.
   * @param {string} platform
   * @returns {Promise<string[]>} distinct externalIds of every NON-voided
   *   issuance (open or completed) on that platform, across all learners;
   *   [] for a blank platform
   */
  async listIssuedExternalIds() { throw new Error('IPrintedActivityStore.listIssuedExternalIds must be implemented'); }

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
   * Record that paper came out for an open issuance: the reservation's first
   * print and every reprint. Sets `lastPrintedAt`, which is what the reprint
   * cooldown reads. Serialized with the other writes. A voided or completed
   * issuance answers its status and writes nothing.
   * @param {string} learnerId
   * @param {string} issuanceId
   * @param {{at: string}} details
   * @returns {Promise<{status: 'marked'|'missing'|'voided'|'completed', issuance: object|null}>}
   */
  async markPrinted() { throw new Error('IPrintedActivityStore.markPrinted must be implemented'); }

  /**
   * The ONE read that throws on a bad record: a corrupt or unreadable learner
   * log throws an error with `code: 'LOG_UNREADABLE'`, so the day's status is
   * "unavailable" rather than a false zero. A missing or empty log is `[]`.
   * @returns {Promise<object[]>} the learner's issuances in `corpusId` whose
   *   `completedStudyDay === studyDay` (never a voided one)
   */
  async listCompletedForDay() { throw new Error('IPrintedActivityStore.listCompletedForDay must be implemented'); }
}

export default IPrintedActivityStore;
