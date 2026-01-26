/**
 * AssignItemToUser Use Case
 * @module homebot/usecases/AssignItemToUser
 *
 * Handles assigning gratitude/hopes items to a specific user when
 * they click a member button in the confirmation UI.
 */

import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

/**
 * Assign item to user use case
 */
export class AssignItemToUser {
  #messagingGateway;
  #conversationStateStore;
  #gratitudeService;
  #householdService;
  #websocketBroadcast;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for updating messages
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} config.gratitudeService - Service for saving gratitude items
   * @param {Object} config.householdService - Service for household member lookup
   * @param {Function} [config.websocketBroadcast] - WebSocket broadcast function
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.messagingGateway) throw new Error('messagingGateway is required');
    if (!config.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!config.gratitudeService) throw new Error('gratitudeService is required');
    if (!config.householdService) throw new Error('householdService is required');

    this.#messagingGateway = config.messagingGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#gratitudeService = config.gratitudeService;
    this.#householdService = config.householdService;
    this.#websocketBroadcast = config.websocketBroadcast;
    this.#logger = config.logger || console;
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
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageId - Message ID of the confirmation UI
   * @param {string} input.username - Username to assign items to
   * @param {string} [input.timezone] - Optional timezone for the selection
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<Object>} Result with success status
   */
  async execute({ conversationId, messageId, username, timezone, responseContext }) {
    this.#logger.info?.('assignItemToUser.start', { conversationId, messageId, username, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Get state from conversation state store
      const state = await this.#conversationStateStore.get(conversationId, messageId);

      if (!state) {
        this.#logger.warn?.('assignItemToUser.noState', { conversationId, messageId });
        await messaging.updateMessage(
          messageId,
          '❌ This selection has expired. Please try again.'
        );
        return { success: false, error: 'No state found - selection may have expired' };
      }

      // 2. Get items and category from flow state
      const { items, category } = state.flowState || {};

      if (!items || items.length === 0) {
        this.#logger.warn?.('assignItemToUser.noItems', { conversationId, messageId });
        await messaging.updateMessage(
          messageId,
          '❌ No items found to save.'
        );
        return { success: false, error: 'No items found in state' };
      }

      // 3. Get household ID
      const householdId = this.#householdService.getHouseholdId();

      // 4. Save items to gratitude service
      try {
        // Generate timestamp with optional timezone adjustment
        const timestamp = timezone
          ? new Date().toLocaleString('en-US', { timeZone: timezone })
          : nowTs24();

        await this.#gratitudeService.addSelections(
          householdId,
          category || 'gratitude',
          username,
          items,
          timestamp
        );
      } catch (saveError) {
        this.#logger.error?.('assignItemToUser.saveError', {
          conversationId,
          error: saveError.message
        });
        await messaging.updateMessage(
          messageId,
          '❌ Failed to save items. Please try again.'
        );
        return { success: false, error: `Failed to save items: ${saveError.message}` };
      }

      // 5. Get display name for success message
      const displayName = await this.#householdService.getMemberDisplayName?.(null, username) || username;

      // 6. Broadcast to WebSocket for frontend update
      if (this.#websocketBroadcast) {
        this.#websocketBroadcast({
          topic: 'gratitude',
          action: 'item_added',
          items: items.map(item => ({ id: item.id, text: item.text })),
          userId: username,
          userName: displayName,
          category: category || 'gratitude',
          source: 'homebot'  // Tells frontend not to persist again
        });
      }

      // 8. Update message to show success
      const itemCount = items.length;
      const categoryLabel = category === 'hopes' ? 'hopes' : 'gratitude';
      const successMessage = `✅ Saved ${itemCount} ${categoryLabel} item${itemCount !== 1 ? 's' : ''} for ${displayName}`;

      await messaging.updateMessage(
        messageId,
        successMessage
      );

      // 9. Clear conversation state
      await this.#conversationStateStore.delete(conversationId, messageId);

      this.#logger.info?.('assignItemToUser.complete', {
        conversationId,
        itemCount,
        username,
        category
      });

      return {
        success: true,
        itemCount,
        username,
        category,
        displayName
      };
    } catch (error) {
      this.#logger.error?.('assignItemToUser.error', {
        conversationId,
        error: error.message
      });
      throw error;
    }
  }
}

export default AssignItemToUser;
