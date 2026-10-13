/**
 * IRoutineHistoryDatastore — port for the household routine history
 * (#domains/media/routineHistory: runs, oldest first).
 */
export class IRoutineHistoryDatastore {
  /** @param {string} [householdId] @returns {Promise<Object[]>} */
  async load(householdId) {
    throw new Error('IRoutineHistoryDatastore.load must be implemented');
  }

  /** @param {Object[]} runs @param {string} [householdId] @returns {Promise<void>} */
  async save(runs, householdId) {
    throw new Error('IRoutineHistoryDatastore.save must be implemented');
  }
}

export default IRoutineHistoryDatastore;
