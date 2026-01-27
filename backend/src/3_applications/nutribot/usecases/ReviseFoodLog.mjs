/**
 * Revise Food Log Use Case
 * @module nutribot/usecases/ReviseFoodLog
 *
 * Enters revision mode for a pending food log.
 */

import { formatFoodList, formatDateHeader } from '#domains/nutrition/entities/formatters.mjs';

/**
 * Revise food log use case
 */
export class ReviseFoodLog {
  #messagingGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || this.#config?.weather?.timezone || 'America/Los_Angeles';
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.logUuid
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, logUuid, messageId, responseContext } = input;

    this.#logger.debug?.('reviseLog.start', { conversationId, logUuid, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    if (!logUuid) {
      this.#logger.error?.('reviseLog.missingLogUuid', { conversationId });
      throw new Error('logUuid is required');
    }

    try {
      // 1. Load the log to show current items
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      // 2. Set conversation state to revision mode
      if (this.#conversationStateStore) {
        const state = {
          conversationId,
          activeFlow: 'revision',
          flowState: {
            pendingLogUuid: logUuid,
            originalMessageId: messageId,
          },
        };
        await this.#conversationStateStore.set(conversationId, state);
        this.#logger.info?.('reviseLog.stateSet', { conversationId, activeFlow: state.activeFlow });
      }

      // 3. Build revision prompt
      const logDate = nutriLog?.meal?.date || nutriLog?.date;
      const dateHeader = logDate ? formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() }) : '';
      const currentItems = formatFoodList(nutriLog?.items || []);
      const message = `✏️ Revise Entry:\n\n${dateHeader ? dateHeader + '\n\n' : ''}${currentItems || '(none)'}`;

      // 4. Update the message or send new one
      const isImageLog = nutriLog?.metadata?.source === 'image';
      const cancelButton = [{ text: '❌ Cancel', callback_data: this.#encodeCallback('cr', { id: logUuid }) }];

      if (messageId) {
        const updatePayload = isImageLog
          ? { caption: message, choices: [cancelButton], inline: true }
          : { text: message, choices: [cancelButton], inline: true };
        await messaging.updateMessage( messageId, updatePayload);
      } else {
        await messaging.sendMessage( message, {
          choices: [cancelButton],
          inline: true,
        });
      }

      this.#logger.info?.('reviseLog.modeEnabled', { conversationId, logUuid });

      return {
        success: true,
        logUuid,
        mode: 'revision',
        message,
      };
    } catch (error) {
      this.#logger.error?.('reviseLog.error', { conversationId, logUuid, error: error.message });
      throw error;
    }
  }
}

export default ReviseFoodLog;
