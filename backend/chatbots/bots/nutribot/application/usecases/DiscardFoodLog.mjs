/**
 * Discard Food Log Use Case
 * @module nutribot/application/usecases/DiscardFoodLog
 * 
 * Discards a pending food log without saving items.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Discard food log use case
 */
export class DiscardFoodLog {
  #messagingGateway;
  #nutrilogRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.logUuid
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, logUuid, messageId } = input;

    this.#logger.debug('discardLog.start', { conversationId, logUuid });

    try {
      // 1. Update log status to DISCARDED
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateStatus(logUuid, 'rejected', conversationId);
      }

      // 2. Clear revision state if any (other flows are stateless)
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.delete(conversationId);
      }

      // 3. Delete the confirmation message (serves as visual confirmation of discard)
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      this.#logger.info('discardLog.complete', { conversationId, logUuid });

      return {
        success: true,
        logUuid,
      };
    } catch (error) {
      this.#logger.error('discardLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default DiscardFoodLog;
