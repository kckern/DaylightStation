/**
 * IAgendaCooldownStore — per-learner record of the last successfully printed
 * agenda (Slice G, 2026-08-22-omr-grading-integrity: "cool down repeat agenda
 * prints").
 *
 * A repeat card tap inside the cooldown window must not put a second,
 * identical slip of paper in the tray — but the same tap must still be able
 * to tell "you already have today's agenda" from "here is genuinely new
 * work", which needs a fingerprint of what was printed alongside when it was
 * printed. This port is dumb storage for exactly that pair, keyed on
 * **learnerId**, never on which physical card was tapped — one child with
 * two cards is still one child, and the cooldown must see them as one.
 *
 * @typedef {{ learnerId: string, lastAgendaPrintedAt: string|null,
 *             contentHash: string|null }} AgendaCooldownRecord
 */
export class IAgendaCooldownStore {
  /**
   * @param {string} learnerId
   * @returns {Promise<AgendaCooldownRecord|null>} null when nothing is on
   *   file, or the file is unreadable — both read as "no cooldown on
   *   record", the fail-open answer: the worst a bad file can do is let one
   *   extra agenda print, never silence a child's first scan of the day.
   */
  async get(learnerId) {
    throw new Error('IAgendaCooldownStore.get must be implemented');
  }

  /**
   * @param {AgendaCooldownRecord} record
   * @returns {Promise<AgendaCooldownRecord>} the stored record
   */
  async put(record) {
    throw new Error('IAgendaCooldownStore.put must be implemented');
  }
}

export default IAgendaCooldownStore;
