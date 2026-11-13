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
 * Issuance: `{issuanceId, learnerId, programId, corpusId, platform, externalId,
 * title, kind, level, issuedAt, issuedStudyDay, completedAt, completedStudyDay,
 * completedVia}`. Open means `completedAt == null`.
 */
export class IPrintedActivityStore {
  /**
   * Record a newly printed page. Throws on a missing key field, an unsafe
   * learner id, or an issuanceId already on record.
   * @param {object} issuance
   * @returns {Promise<object>} the stored issuance
   */
  async append() { throw new Error('IPrintedActivityStore.append must be implemented'); }

  /** @returns {Promise<object[]>} every issuance for the learner, oldest first; [] on any read problem */
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
   * @returns {Promise<object|null>} the most recently issued issuance for that page, any status
   */
  async findAny() { throw new Error('IPrintedActivityStore.findAny must be implemented'); }

  /**
   * Mark an issuance done. IDEMPOTENT: a second scan of the same page answers
   * `already` with the issuance as first completed, and writes nothing.
   * @param {string} learnerId
   * @param {string} issuanceId
   * @param {{at: string, studyDay: string, device: string|null}} completion
   * @returns {Promise<{status: 'completed'|'already'|'missing', issuance: object|null}>}
   */
  async complete() { throw new Error('IPrintedActivityStore.complete must be implemented'); }

  /**
   * @returns {Promise<object[]>} the learner's issuances in `corpusId` whose
   *   `completedStudyDay === studyDay`
   */
  async listCompletedForDay() { throw new Error('IPrintedActivityStore.listCompletedForDay must be implemented'); }
}

export default IPrintedActivityStore;
