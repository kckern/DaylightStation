/**
 * IConversationStore - Port interface for conversation persistence
 */

export const IConversationStore = {
  /**
   * Save a conversation
   * @param {Conversation} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(conversation) {},

  /**
   * Find conversation by ID
   * @param {string} id - Conversation ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {},

  /**
   * Find conversation by participants
   * @param {string[]} participants - Participant IDs
   * @returns {Promise<Object|null>}
   */
  async findByParticipants(participants) {},

  /**
   * Find conversations for a participant
   * @param {string} participantId - Participant ID
   * @returns {Promise<Object[]>}
   */
  async findByParticipant(participantId) {},

  /**
   * Find active conversations (recent messages)
   * @param {number} thresholdMinutes - Activity threshold
   * @returns {Promise<Object[]>}
   */
  async findActive(thresholdMinutes) {},

  /**
   * Delete a conversation
   * @param {string} id - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(id) {}
};

export default IConversationStore;
