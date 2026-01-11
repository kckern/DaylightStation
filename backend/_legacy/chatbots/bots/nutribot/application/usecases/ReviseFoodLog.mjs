/**
 * Revise Food Log Use Case
 * @module nutribot/application/usecases/ReviseFoodLog
 * 
 * Enters revision mode for a pending food log.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';
import { formatFoodList, formatDateHeader } from '../../domain/formatters.mjs';

/**
 * Revise food log use case
 */
export class ReviseFoodLog {
  #messagingGateway;
  #nutrilogRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || this.#config?.weather?.timezone || 'America/Los_Angeles';
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

    this.#logger.debug('reviseLog.start', { conversationId, logUuid });

    if (!logUuid) {
      this.#logger.error('reviseLog.missingLogUuid', { conversationId });
      throw new Error('logUuid is required');
    }

    try {
      // 1. Load the log to show current items
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid, conversationId);
      }

      // 2. Set conversation state to revision mode
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'revision',
          flowState: { 
            pendingLogUuid: logUuid,
            originalMessageId: messageId,
          },
        });
        await this.#conversationStateStore.set(conversationId, state);
        this.#logger.info('reviseLog.stateSet', { conversationId, activeFlow: state.activeFlow, pendingLogUuid: state.flowState.pendingLogUuid });
      } else {
        this.#logger.warn('reviseLog.noStateStore', { conversationId });
      }

      // 3. Build revision prompt with same format as initial response
      const logDate = nutriLog?.meal?.date || nutriLog?.date;
      const dateHeader = logDate ? formatDateHeader(logDate, { timezone: this.#getTimezone() }) : '';
      const currentItems = formatFoodList(nutriLog?.items || []);
      const message = `✏️ Revise Entry:\n\n${dateHeader ? dateHeader + '\n\n' : ''}${currentItems || '(none)'}`;

      // 4. Update the message or send new one
      // For image-based logs, original message is a photo - use caption instead of text
      const isImageLog = nutriLog?.metadata?.source === 'image';
      const cancelButton = [{ text: '❌ Cancel', callback_data: encodeCallback('cr', { id: logUuid }) }];

      if (messageId) {
        const updatePayload = isImageLog
          ? { caption: message, choices: [cancelButton], inline: true }
          : { text: message, choices: [cancelButton], inline: true };
        await this.#messagingGateway.updateMessage(conversationId, messageId, updatePayload);
      } else {
        await this.#messagingGateway.sendMessage(conversationId, message, {
          choices: [cancelButton],
          inline: true,
        });
      }

      this.#logger.info('reviseLog.modeEnabled', { conversationId, logUuid });

      return {
        success: true,
        logUuid,
        mode: 'revision',
        message, // Include message for testing/debugging
      };
    } catch (error) {
      this.#logger.error('reviseLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default ReviseFoodLog;
