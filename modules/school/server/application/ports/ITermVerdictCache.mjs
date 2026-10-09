/**
 * Where a learner's per-day term verdicts are kept between reads.
 *
 * A CACHE, NOT A RECORD. Every row in it is `termVerdict.dayVerdict`'s output
 * for one day, and every row can be recomputed from the session log, the
 * reading log and the program launchers. Deleting the whole store is always
 * safe; the next read rebuilds what it needs. Rows carry the ladder's
 * `VERDICT_VERSION`, and a row from an older ladder is discarded on read.
 *
 * @interface ITermVerdictCache
 */
export class ITermVerdictCache {
  /**
   * @param {string} learnerId
   * @param {string} termId
   * @returns {Promise<{version: number, computedAt: string|null,
   *   days: Record<string, object>}|null>} null when nothing is cached
   */
  // eslint-disable-next-line no-unused-vars
  async read(learnerId, termId) { throw new Error('ITermVerdictCache.read must be implemented'); }

  /**
   * Replace the cached document for one learner + term, atomically.
   * @param {string} learnerId
   * @param {string} termId
   * @param {{version: number, computedAt: string, days: Record<string, object>}} doc
   */
  // eslint-disable-next-line no-unused-vars
  async write(learnerId, termId, doc) { throw new Error('ITermVerdictCache.write must be implemented'); }
}

export default ITermVerdictCache;
