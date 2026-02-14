// backend/src/3_applications/agents/framework/ports/IWorkingMemory.mjs

/**
 * Port interface for working memory persistence (framework-agnostic)
 * @interface IWorkingMemory
 *
 * Implementations handle storage (YAML files, database, etc).
 * The application layer uses this to load/save WorkingMemoryState.
 */
export const IWorkingMemory = {
  /**
   * Load working memory state for an agent + user
   * @param {string} agentId - Agent identifier
   * @param {string} userId - User identifier
   * @returns {Promise<WorkingMemoryState>} Hydrated state (empty if no prior state)
   */
  async load(agentId, userId) {},

  /**
   * Save working memory state for an agent + user
   * @param {string} agentId - Agent identifier
   * @param {string} userId - User identifier
   * @param {WorkingMemoryState} state - State to persist
   * @returns {Promise<void>}
   */
  async save(agentId, userId, state) {},
};

/**
 * Type guard for IWorkingMemory
 * @param {any} obj
 * @returns {boolean}
 */
export function isWorkingMemoryStore(obj) {
  return obj && typeof obj.load === 'function' && typeof obj.save === 'function';
}
