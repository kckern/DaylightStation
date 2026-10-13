/**
 * IConversationDatastore - Port interface for conversation persistence
 *
 * The datastore owns hydration/dehydration: it accepts and returns
 * Conversation ENTITIES (with Message entities inside), never raw
 * storage-shaped plain objects.
 *
 * @typedef {import('#domains/messaging/entities/Conversation.mjs').Conversation} Conversation
 */

export class IConversationDatastore {
  /**
   * Save a conversation (implementation dehydrates to storage format)
   * @param {Conversation} conversation - Conversation entity to save
   * @returns {Promise<void>}
   */
  async save(conversation) {
    throw new Error('IConversationDatastore.save must be implemented');
  }

  /**
   * Find conversation by ID (implementation hydrates to an entity)
   * @param {string} id - Conversation ID
   * @returns {Promise<Conversation|null>}
   */
  async findById(id) {
    throw new Error('IConversationDatastore.findById must be implemented');
  }

  /**
   * Find conversation by participants
   * @param {string[]} participants - Participant IDs
   * @returns {Promise<Conversation|null>}
   */
  async findByParticipants(participants) {
    throw new Error('IConversationDatastore.findByParticipants must be implemented');
  }

  /**
   * Find conversations for a participant
   * @param {string} participantId - Participant ID
   * @returns {Promise<Conversation[]>}
   */
  async findByParticipant(participantId) {
    throw new Error('IConversationDatastore.findByParticipant must be implemented');
  }

  /**
   * Find active conversations (recent messages)
   * @param {number} thresholdMinutes - Activity threshold
   * @returns {Promise<Conversation[]>}
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
