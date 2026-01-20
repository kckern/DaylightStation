/**
 * AssignItemToUser Use Case
 * @module homebot/usecases/AssignItemToUser
 *
 * Handles assigning gratitude/hopes items to a specific user when
 * they click a member button in the confirmation UI.
 */

/**
 * Assign item to user use case
 */
export class AssignItemToUser {
  #messagingGateway;
  #conversationStateStore;
  #gratitudeService;
  #householdService;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for updating messages
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} config.gratitudeService - Service for saving gratitude items
   * @param {Object} config.householdService - Service for household member lookup
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
    this.#logger = config.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageId - Message ID of the confirmation UI
   * @param {string} input.username - Username to assign items to
   * @param {string} [input.timezone] - Optional timezone for the selection
   * @returns {Promise<Object>} Result with success status
   */
  async execute({ conversationId, messageId, username, timezone }) {
    this.#logger.info?.('assignItemToUser.start', { conversationId, messageId, username });

    try {
      // 1. Get state from conversation state store
      const state = await this.#conversationStateStore.get(conversationId, messageId);

      if (!state) {
        this.#logger.warn?.('assignItemToUser.noState', { conversationId, messageId });
        await this.#messagingGateway.updateMessage(
          conversationId,
          messageId,
          '❌ This selection has expired. Please try again.'
        );
        return { success: false, error: 'No state found - selection may have expired' };
      }

      // 2. Get items and category from flow state
      const { items, category } = state.flowState || {};

      if (!items || items.length === 0) {
        this.#logger.warn?.('assignItemToUser.noItems', { conversationId, messageId });
        await this.#messagingGateway.updateMessage(
          conversationId,
          messageId,
          '❌ No items found to save.'
        );
        return { success: false, error: 'No items found in state' };
      }

      // 3. Get household ID
      const householdId = this.#householdService.getHouseholdId();

      // 4. Save items to gratitude service
      try {
        await this.#gratitudeService.addSelections(
          householdId,
          category || 'gratitude',
          username,
          items,
          timezone
        );
      } catch (saveError) {
        this.#logger.error?.('assignItemToUser.saveError', {
          conversationId,
          error: saveError.message
        });
        await this.#messagingGateway.updateMessage(
          conversationId,
          messageId,
          '❌ Failed to save items. Please try again.'
        );
        return { success: false, error: `Failed to save items: ${saveError.message}` };
      }

      // 5. Get display name for success message
      const member = this.#householdService.getMemberByUsername?.(username);
      const displayName = member?.displayName || username;

      // 6. Update message to show success
      const itemCount = items.length;
      const categoryLabel = category === 'hopes' ? 'hopes' : 'gratitude';
      const successMessage = `✅ Saved ${itemCount} ${categoryLabel} item${itemCount !== 1 ? 's' : ''} for ${displayName}`;

      await this.#messagingGateway.updateMessage(
        conversationId,
        messageId,
        successMessage
      );

      // 7. Clear conversation state
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
