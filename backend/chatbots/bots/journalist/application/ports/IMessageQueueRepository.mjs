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
 * @param {string} messageId - Telegram message ID
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

// Export interface documentation
export const IMessageQueueRepository = {
  name: 'IMessageQueueRepository',
  methods: ['loadUnsentQueue', 'saveToQueue', 'markSent', 'clearQueue', 'deleteUnprocessed'],
};

export default IMessageQueueRepository;
