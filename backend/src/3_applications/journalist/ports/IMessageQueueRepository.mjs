/**
 * IMessageQueueRepository Port
 * @module journalist/application/ports/IMessageQueueRepository
 *
 * Repository for message queue management.
 */

/**
 * @interface IMessageQueueRepository
 */

/**
 * Load unsent queue items for a chat
 * @function
 * @name IMessageQueueRepository#loadUnsentQueue
 * @param {string} chatId
 * @returns {Promise<MessageQueue[]>}
 */

/**
 * Save queue items
 * @function
 * @name IMessageQueueRepository#saveToQueue
 * @param {string} chatId
 * @param {MessageQueue[]} items
 * @returns {Promise<void>}
 */

/**
 * Mark a queue item as sent
 * @function
 * @name IMessageQueueRepository#markSent
 * @param {string} uuid - Queue item UUID
 * @param {string} messageId - Message ID from messaging platform
 * @returns {Promise<void>}
 */

/**
 * Clear entire queue for a chat
 * @function
 * @name IMessageQueueRepository#clearQueue
 * @param {string} chatId
 * @returns {Promise<void>}
 */

/**
 * Delete unprocessed/unsent items
 * @function
 * @name IMessageQueueRepository#deleteUnprocessed
 * @param {string} chatId
 * @returns {Promise<void>}
 */

export class IMessageQueueRepository {
  async loadUnsentQueue() { throw new Error('IMessageQueueRepository.loadUnsentQueue not implemented'); }
  async saveToQueue() { throw new Error('IMessageQueueRepository.saveToQueue not implemented'); }
  async markSent() { throw new Error('IMessageQueueRepository.markSent not implemented'); }
}

export default IMessageQueueRepository;
