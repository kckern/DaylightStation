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
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for updating messages
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    if (!config.messagingGateway) throw new Error('messagingGateway is required');
    if (!config.conversationStateStore) throw new Error('conversationStateStore is required');

    this.#messagingGateway = config.messagingGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#logger = config.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageId - Message ID of the confirmation UI
   * @param {string} [input.category] - Optional category to toggle to (if not provided, toggles current)
   * @returns {Promise<Object>} Result with success status and new category
   */
  async execute({ conversationId, messageId, category }) {
    this.#logger.info?.('toggleCategory.start', { conversationId, messageId, category });

    try {
      // 1. Get state from conversation state store
      const state = await this.#conversationStateStore.get(conversationId, messageId);

      if (!state) {
        this.#logger.warn?.('toggleCategory.noState', { conversationId, messageId });
        await this.#messagingGateway.updateMessage(
          conversationId,
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

      await this.#conversationStateStore.set(conversationId, messageId, updatedState);

      // 4. Update message to show new category label
      const categoryLabel = newCategory === 'hopes' ? 'Hopes' : 'Gratitude';
      const items = state.flowState?.items || [];
      const itemCount = items.length;
      const itemList = items.map(item => `• ${item.text || item}`).join('\n');

      const updatedMessage = `📝 *${categoryLabel} Items* (${itemCount}):\n${itemList}\n\nWho should these be saved for?`;

      await this.#messagingGateway.updateMessage(
        conversationId,
        messageId,
        updatedMessage
      );

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
