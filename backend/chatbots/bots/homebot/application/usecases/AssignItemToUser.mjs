/**
 * Assign Item To User Use Case
 * @module homebot/application/usecases/AssignItemToUser
 * 
 * Handles user selection callback - persists items to gratitude store
 * and broadcasts to WebSocket for real-time TV updates.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Assign Item To User Use Case
 */
export class AssignItemToUser {
  #messagingGateway;
  #gratitudeRepository;
  #householdRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#gratitudeRepository = deps.gratitudeRepository;
    this.#householdRepository = deps.householdRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'homebot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.conversationId - Chat ID
   * @param {string} input.callbackQueryId - Callback query ID to answer
   * @param {string} input.messageId - Message ID to update/delete
   * @param {string} input.selectedUserId - Selected household member username
   */
  async execute(input) {
    const { conversationId, callbackQueryId, messageId, selectedUserId } = input;

    this.#logger.info('assignItemToUser.start', { conversationId, selectedUserId });

    try {
      // 1. Get conversation state
      if (!this.#conversationStateStore) {
        this.#logger.error('assignItemToUser.noStateStore');
        await this.#sendError(conversationId, 'Session error. Please try again.');
        return;
      }

      const state = await this.#conversationStateStore.get(conversationId);
      
      if (!state || state.activeFlow !== 'gratitude_input') {
        this.#logger.warn('assignItemToUser.noActiveFlow', { conversationId });
        await this.#sendError(conversationId, 'Session expired. Please send your gratitude items again.');
        return;
      }

      const { items, category } = state.flowState;

      if (!items || items.length === 0) {
        this.#logger.warn('assignItemToUser.noItems', { conversationId });
        await this.#sendError(conversationId, 'No items to save. Please try again.');
        return;
      }

      // 2. Get user display name
      let displayName = selectedUserId;
      if (this.#householdRepository) {
        const member = await this.#householdRepository.getMemberByUsername(selectedUserId);
        displayName = member?.displayName || selectedUserId;
      }

      // 3. Persist items to gratitude store
      if (this.#gratitudeRepository) {
        await this.#gratitudeRepository.addSelections(category, selectedUserId, items);
        
        // 4. Broadcast to WebSocket for real-time TV updates
        this.#gratitudeRepository.broadcastItems({
          category,
          userId: selectedUserId,
          userName: displayName,
          items,
        });
      } else {
        this.#logger.warn('assignItemToUser.noGratitudeRepository', { 
          message: 'Items not persisted - no repository configured' 
        });
      }

      // 5. Update the confirmation message with success (same message, updated)
      const emoji = category === 'gratitude' ? '🙏' : '✨';
      const itemText = items.length === 1 ? 'item' : 'items';
      const successText = `${emoji} Added ${items.length} ${category} ${itemText} for <b>${displayName}</b>!`;
      
      if (messageId) {
        try {
          await this.#messagingGateway.updateMessage(conversationId, messageId, {
            text: successText,
            parseMode: 'HTML',
          });
        } catch (e) {
          // If update fails, send new message
          this.#logger.debug('assignItemToUser.updateMessage.failed', { error: e.message });
          await this.#messagingGateway.sendMessage(conversationId, successText, { parseMode: 'HTML' });
        }
      } else {
        await this.#messagingGateway.sendMessage(conversationId, successText, { parseMode: 'HTML' });
      }

      // 6. Clear conversation state
      await this.#conversationStateStore.delete(conversationId);

      this.#logger.info('assignItemToUser.complete', { 
        conversationId, 
        selectedUserId,
        category,
        itemCount: items.length,
      });

    } catch (error) {
      this.#logger.error('assignItemToUser.failed', {
        conversationId,
        error: error.message,
        stack: error.stack,
      });

      await this.#sendError(conversationId, 'Failed to save items. Please try again.');
    }
  }

  /**
   * Send error message to user
   * @private
   */
  async #sendError(conversationId, message) {
    try {
      await this.#messagingGateway.sendMessage(conversationId, `❌ ${message}`);
    } catch (e) {
      this.#logger.error('assignItemToUser.sendError.failed', { error: e.message });
    }
  }
}

export default AssignItemToUser;
