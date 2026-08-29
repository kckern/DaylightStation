// backend/src/3_applications/agents/ports/IMemoryDatastore.mjs

/**
 * Port interface for agent conversation memory (framework-agnostic)
 * @interface IMemoryDatastore
 */
export class IMemoryDatastore {
  /**
   * Get conversation history for an agent
   * @param {string} agentId - Agent identifier
   * @param {string} conversationId - Conversation/session identifier
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async getConversation(_agentId, _conversationId) { throw new Error('IMemoryDatastore.getConversation not implemented'); }

  /**
   * Save a message to conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @param {Object} message - {role: 'user'|'assistant', content: string}
   * @returns {Promise<void>}
   */
  async saveMessage(_agentId, _conversationId, _message) { throw new Error('IMemoryDatastore.saveMessage not implemented'); }

  /**
   * Clear conversation history
   * @param {string} agentId
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async clearConversation(_agentId, _conversationId) { throw new Error('IMemoryDatastore.clearConversation not implemented'); }
}

/**
 * Type guard for IMemoryDatastore
 * @param {any} obj
 * @returns {boolean}
 */
export function isMemoryDatastore(obj) {
  return (
    obj &&
    typeof obj.getConversation === 'function' &&
    typeof obj.saveMessage === 'function' &&
    typeof obj.clearConversation === 'function'
  );
}
