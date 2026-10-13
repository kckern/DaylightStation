/**
 * IReadingLogStore — durable evidence that a learner finished a story.
 *
 * Records, not runtime: this is what a report card is reconstructed from, so it
 * lives under `school/records/` rather than `school/runtime/`, and it is never
 * pruned by a cooldown or a session close.
 *
 * SHARDED BY STUDY DAY, not by UTC date. The study day is 4am->4am in the
 * household timezone; sharding by the key the agenda actually asks about means
 * `countForDay` is one file read with no timezone reconciliation. See
 * `SurfaceProgramLauncher`'s header for what the alternative costs.
 */
export class IReadingLogStore {
  /**
   * IDEMPOTENT ON `pickId`. The caller mints one id per finish and may send it
   * more than once — a retried request, a remounted player. `doneToday` is
   * `rows.length >= target`, so a duplicate row is a duplicate BOOK: the same
   * child credited twice for one story. An implementation must therefore
   * return the existing row unchanged when the day already holds one with this
   * `pickId`, rather than appending a second. A `null` pickId is not a key and
   * never dedupes — two hand-recorded reads of the same book are two reads.
   *
   * @param {{learnerId: string, studyDay: string, at: string, contentId: string|null,
   *          title: string|null, tagUid: string|null, location: string|null,
   *          pickId: string|null}} row
   * @returns {Promise<object>} the stored row — the existing one on a repeat
   */
  async append() { throw new Error('IReadingLogStore.append not implemented'); }

  /**
   * @param {string} learnerId
   * @param {string} studyDay - YYYY-MM-DD
   * @returns {Promise<object[]>} rows for that learner and study day, oldest first
   */
  async listForDay() { throw new Error('IReadingLogStore.listForDay not implemented'); }

  /** Return the idempotent row, if any, after an ambiguous completion write. */
  async findByPickId() { throw new Error('IReadingLogStore.findByPickId not implemented'); }
}

export default IReadingLogStore;
