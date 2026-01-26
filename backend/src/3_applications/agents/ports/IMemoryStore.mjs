// backend/src/3_applications/agents/ports/IMemoryStore.mjs

/**
 * Port interface for agent conversation memory (framework-agnostic)
 * @interface IMemoryStore
 */
export const IMemoryStore = {
  /**
   * Get conversation history for an agent
   * @param {string} agentId - Agent identifier
   * @param {string} conversationId - Conversation/session identifier
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async getConversation(agentId, conversationId) {},

  /**
   * Save a message to conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @param {Object} message - {role: 'user'|'assistant', content: string}
   * @returns {Promise<void>}
   */
  async saveMessage(agentId, conversationId, message) {},

  /**
   * Clear conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async clearConversation(agentId, conversationId) {},
};

/**
 * Type guard for IMemoryStore
 * @param {any} obj
 * @returns {boolean}
 */
export function isMemoryStore(obj) {
  return (
    obj &&
    typeof obj.getConversation === 'function' &&
    typeof obj.saveMessage === 'function' &&
    typeof obj.clearConversation === 'function'
  );
}
