/**
 * IConversationDatastore - Port interface for conversation persistence
 */

export class IConversationDatastore {
  /**
   * Save a conversation
   * @param {Conversation} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(conversation) {
    throw new Error('IConversationDatastore.save must be implemented');
  }

  /**
   * Find conversation by ID
   * @param {string} id - Conversation ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    throw new Error('IConversationDatastore.findById must be implemented');
  }

  /**
   * Find conversation by participants
   * @param {string[]} participants - Participant IDs
   * @returns {Promise<Object|null>}
   */
  async findByParticipants(participants) {
    throw new Error('IConversationDatastore.findByParticipants must be implemented');
  }

  /**
   * Find conversations for a participant
   * @param {string} participantId - Participant ID
   * @returns {Promise<Object[]>}
   */
  async findByParticipant(participantId) {
    throw new Error('IConversationDatastore.findByParticipant must be implemented');
  }

  /**
   * Find active conversations (recent messages)
   * @param {number} thresholdMinutes - Activity threshold
   * @returns {Promise<Object[]>}
   */
  async findActive(thresholdMinutes) {
    throw new Error('IConversationDatastore.findActive must be implemented');
  }

  /**
   * Delete a conversation
   * @param {string} id - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    throw new Error('IConversationDatastore.delete must be implemented');
  }
}

export default IConversationDatastore;
