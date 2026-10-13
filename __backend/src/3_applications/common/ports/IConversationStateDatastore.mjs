/**
 * @typedef {Object} ConversationState
 * @property {string} activeFlow - Current flow name (e.g., 'gratitude_input', 'revision')
 * @property {Object} flowState - Flow-specific state data
 * @property {string} [updatedAt] - ISO timestamp of last update
 * @property {Object} [sessions] - Message-keyed session data
 */

/**
 * Interface for conversation state persistence
 * Supports multi-turn conversation flows with optional message-keyed sessions
 */
export class IConversationStateDatastore {
  /**
   * Get conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional message key for session
   * @returns {Promise<ConversationState|null>}
   */
  async get(conversationId, messageId) {
    throw new Error('IConversationStateDatastore.get() must be implemented');
  }

  /**
   * Set conversation state
   * @param {string} conversationId
   * @param {ConversationState} state
   * @param {string} [messageId] - Optional message key for session
   */
  async set(conversationId, state, messageId) {
    throw new Error('IConversationStateDatastore.set() must be implemented');
  }

  /**
   * Delete conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional: delete specific session
   */
  async delete(conversationId, messageId) {
    throw new Error('IConversationStateDatastore.delete() must be implemented');
  }

  /**
   * Clear all state for a conversation
   * @param {string} conversationId
   */
  async clear(conversationId) {
    throw new Error('IConversationStateDatastore.clear() must be implemented');
  }
}

/**
 * Type guard for IConversationStateDatastore
 */
export function isConversationStateDatastore(obj) {
  return obj &&
    typeof obj.get === 'function' &&
    typeof obj.set === 'function' &&
    typeof obj.delete === 'function' &&
    typeof obj.clear === 'function';
}

export default IConversationStateDatastore;
