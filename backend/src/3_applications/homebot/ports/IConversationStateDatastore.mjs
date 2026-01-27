// backend/src/3_applications/homebot/ports/IConversationStateDatastore.mjs

/**
 * Port interface for conversation state persistence
 * Used to store temporary UI flow state during multi-step interactions
 * @interface IConversationStateDatastore
 */
export const IConversationStateDatastore = {
  /**
   * Get state for a conversation/message
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<Object|null>}
   */
  async get(conversationId, messageId) {},

  /**
   * Set state for a conversation/message
   * @param {string} conversationId
   * @param {string} messageId
   * @param {Object} state
   * @param {number} [ttlMs] - Time to live in milliseconds
   * @returns {Promise<void>}
   */
  async set(conversationId, messageId, state, ttlMs) {},

  /**
   * Delete state for a conversation/message
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<boolean>}
   */
  async delete(conversationId, messageId) {},

  /**
   * Check if state exists
   * @param {string} conversationId
   * @param {string} [messageId]
   * @returns {Promise<boolean>}
   */
  async has(conversationId, messageId) {}
};

/**
 * Validate object implements IConversationStateDatastore
 * @param {Object} obj
 * @returns {boolean}
 */
export function isConversationStateDatastore(obj) {
  return (
    obj &&
    typeof obj.get === 'function' &&
    typeof obj.set === 'function' &&
    typeof obj.delete === 'function'
  );
}
