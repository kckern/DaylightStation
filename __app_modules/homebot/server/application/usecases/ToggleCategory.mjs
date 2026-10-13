/**
 * ToggleCategory Use Case
 * @module homebot/usecases/ToggleCategory
 *
 * Handles toggling between gratitude and hopes categories when
 * the user clicks the "Switch to Hopes/Gratitude" button.
 */

/**
 * Toggle category use case
 */
export class ToggleCategory {
  #messagingGateway;
  #conversationStateStore;
  #householdService;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for updating messages
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} config.householdService - Service for household member lookup
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.messagingGateway) throw new Error('messagingGateway is required');
    if (!config.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!config.householdService) throw new Error('householdService is required');

    this.#messagingGateway = config.messagingGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdService = config.householdService;
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
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageId - Message ID of the confirmation UI
   * @param {string} [input.category] - Optional category to toggle to (if not provided, toggles current)
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<Object>} Result with success status and new category
   */
  async execute({ conversationId, messageId, category, responseContext }) {
    this.#logger.info?.('toggleCategory.start', { conversationId, messageId, category, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Get state from conversation state store
      const state = await this.#conversationStateStore.get(conversationId, messageId);

      if (!state) {
        this.#logger.warn?.('toggleCategory.noState', { conversationId, messageId });
        await messaging.updateMessage(
          messageId,
          '❌ This selection has expired. Please try again.'
        );
        return { success: false, error: 'No state found - selection may have expired' };
      }

      // 2. Determine new category (toggle between gratitude and hopes)
      const currentCategory = state.flowState?.category || 'gratitude';
      const newCategory = category || (currentCategory === 'gratitude' ? 'hopes' : 'gratitude');

      // 3. Update state with new category
      const updatedState = {
        ...state,
        flowState: {
          ...state.flowState,
          category: newCategory
        }
      };

      await this.#conversationStateStore.set(conversationId, updatedState, messageId);

      // 4. Build updated message and keyboard
      const items = state.flowState?.items || [];
      const itemList = items.map(item => `• ${item.text || item}`).join('\n');
      const categoryLabel = newCategory === 'gratitude' ? 'grateful' : 'hoping';
      const updatedMessage = `📝 <b>Items to Add</b>\n\n${itemList}\n\n<i>Who is ${categoryLabel} for these?</i>`;

      // Get members for keyboard
      const members = await this.#householdService?.getMembers?.() || [];

      // Build keyboard matching legacy pattern
      const choices = [];

      // Row 1: Category toggle (both options, ✅ on selected)
      choices.push([
        {
          label: newCategory === 'gratitude' ? '✅ Gratitude' : 'Gratitude',
          data: 'category:gratitude'
        },
        {
          label: newCategory === 'hopes' ? '✅ Hopes' : 'Hopes',
          data: 'category:hopes'
        }
      ]);

      // Member rows (3 per row)
      const memberButtons = members.map(member => ({
        label: member.groupLabel || member.displayName || member.userId,
        data: `user:${member.userId}`
      }));

      for (let i = 0; i < memberButtons.length; i += 3) {
        choices.push(memberButtons.slice(i, i + 3));
      }

      // Cancel row
      choices.push([{ label: '❌ Cancel', data: 'cancel' }]);

      await messaging.updateMessage(messageId, {
        text: updatedMessage,
        parseMode: 'HTML',
        choices
      });

      this.#logger.info?.('toggleCategory.complete', {
        conversationId,
        previousCategory: currentCategory,
        newCategory
      });

      return {
        success: true,
        previousCategory: currentCategory,
        newCategory
      };
    } catch (error) {
      this.#logger.error?.('toggleCategory.error', {
        conversationId,
        error: error.message
      });
      throw error;
    }
  }
}

export default ToggleCategory;
