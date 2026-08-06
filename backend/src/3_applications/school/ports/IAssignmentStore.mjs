/**
 * IAssignmentStore — persistence contract for what a parent has assigned.
 * @module applications/school/ports/IAssignmentStore
 *
 * Assignments are PLANNER INPUT, never catalog content (spec §7.2: "planning
 * writes planner config, never the published catalog"). One record per learner:
 * which courses and which individual units they are expected to work through.
 * Nothing here says what a unit IS — that is the catalog's job — so a parent can
 * reassign freely without any risk of editing curriculum.
 *
 * A missing record is not an error. A child with no assignments gets an agenda
 * that says so, which is a better answer than a failure at the printer.
 *
 * WRITES ARE ADULT-ONLY, and that is enforced by `SetAssignments`, not here.
 * This port is dumb storage: it will write whatever record it is handed, which
 * is precisely why nothing but the use case may call `put`.
 *
 * @typedef {{ learnerId: string,
 *             courses: Array<string|{courseId: string, elective?: boolean}>,
 *             units: Array<string|{unitId: string, elective?: boolean}>,
 *             assignedBy?: string|null,
 *             updatedAt?: string }} AssignmentRecord
 */
export class IAssignmentStore {
  /**
   * @param {string} learnerId
   * @returns {Promise<AssignmentRecord|null>} null when nothing is assigned or
   *   the record is unreadable — the caller prints "nothing assigned", never a 500
   */
  async get(learnerId) {
    throw new Error('IAssignmentStore.get must be implemented');
  }

  /**
   * @param {AssignmentRecord} record
   * @returns {Promise<AssignmentRecord>} the stored record
   */
  async put(record) {
    throw new Error('IAssignmentStore.put must be implemented');
  }

  /**
   * Every learner with an assignment record — the parent surface's index.
   * @returns {Promise<AssignmentRecord[]>}
   */
  async list() {
    throw new Error('IAssignmentStore.list must be implemented');
  }

  /**
   * Every plan change for a learner, oldest first — not just the latest.
   * Each entry is the `AssignmentRecord` in effect at that point plus
   * `recordedAt` (the moment it became current). `get()` only ever answers
   * "what's assigned now"; this is the only place "what used to be assigned,
   * and who changed it" survives.
   * @param {string} learnerId
   * @returns {Promise<Array<AssignmentRecord & {recordedAt: string}>>} empty
   *   when the learner has no recorded history
   */
  async history(learnerId) {
    throw new Error('IAssignmentStore.history must be implemented');
  }
}

export default IAssignmentStore;
