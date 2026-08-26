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
   * @param {{learnerId: string, studyDay: string, at: string, contentId: string|null,
   *          title: string|null, tagUid: string|null, location: string|null}} row
   * @returns {Promise<object>} the stored row
   */
  async append() { throw new Error('IReadingLogStore.append not implemented'); }

  /**
   * @param {string} learnerId
   * @param {string} studyDay - YYYY-MM-DD
   * @returns {Promise<object[]>} rows for that learner and study day, oldest first
   */
  async listForDay() { throw new Error('IReadingLogStore.listForDay not implemented'); }
}

export default IReadingLogStore;
