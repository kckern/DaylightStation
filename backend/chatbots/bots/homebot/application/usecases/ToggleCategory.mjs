/**
 * Toggle Category Use Case
 * @module homebot/application/usecases/ToggleCategory
 * 
 * Handles category toggle callback - updates state and re-renders the confirmation keyboard.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * Toggle Category Use Case
 */
export class ToggleCategory {
  #messagingGateway;
  #householdRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
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
   * @param {string} input.messageId - Message ID to update
   * @param {string} input.category - New category ('gratitude' or 'hopes')
   */
  async execute(input) {
    const { conversationId, callbackQueryId, messageId, category } = input;

    this.#logger.info('toggleCategory.start', { conversationId, category });

    try {
      // 1. Get current state
      if (!this.#conversationStateStore) {
        this.#logger.warn('toggleCategory.noStateStore');
        return;
      }

      const state = await this.#conversationStateStore.get(conversationId);
      
      if (!state || state.activeFlow !== 'gratitude_input') {
        this.#logger.warn('toggleCategory.noActiveFlow', { conversationId });
        // Session expired - can't toggle
        await this.#messagingGateway.sendMessage(conversationId, 
          '❌ Session expired. Please send your gratitude items again.'
        );
        return;
      }

      // 2. Check if category is already selected (no change needed)
      if (state.flowState.category === category) {
        this.#logger.debug('toggleCategory.noChange', { category });
        return;
      }

      // 3. Update state with new category (clone to avoid read-only issues)
      const updatedState = {
        ...state,
        flowState: {
          ...state.flowState,
          category,
        },
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      };
      await this.#conversationStateStore.set(conversationId, updatedState);

      // 4. Get household members for keyboard
      const members = await this.#getHouseholdMembers();

      // 5. Rebuild message and keyboard
      const items = updatedState.flowState.items.map(i => i.text);
      const messageText = this.#buildConfirmationMessage(items, category);
      const keyboard = this.#buildConfirmationKeyboard(members, category);

      // 6. Update the message
      await this.#messagingGateway.updateMessage(conversationId, messageId, {
        text: messageText,
        parseMode: 'HTML',
        choices: keyboard,
      });

      this.#logger.info('toggleCategory.complete', { conversationId, category });

    } catch (error) {
      this.#logger.error('toggleCategory.failed', {
        conversationId,
        error: error.message,
      });
    }
  }

  /**
   * Get household members
   * @private
   */
  async #getHouseholdMembers() {
    if (this.#householdRepository) {
      return this.#householdRepository.getHouseholdMembers();
    }
    return [];
  }

  /**
   * Build the confirmation message text
   * @private
   */
  #buildConfirmationMessage(items, category) {
    const header = `📝 <b>Items to Add</b>\n\n`;
    const itemList = items.map(item => `• ${item}`).join('\n');
    const categoryLabel = category === 'gratitude' ? 'grateful' : 'hoping';
    const prompt = `\n\n<i>Who is ${categoryLabel} for these?</i>`;
    
    return header + itemList + prompt;
  }

  /**
   * Build the confirmation keyboard with category toggle and user buttons
   * @private
   */
  #buildConfirmationKeyboard(members, currentCategory) {
    const keyboard = [];
    
    // Category toggle row
    keyboard.push([
      {
        text: currentCategory === 'gratitude' ? '✅ Gratitude' : 'Gratitude',
        callback_data: 'category:gratitude',
      },
      {
        text: currentCategory === 'hopes' ? '✅ Hopes' : 'Hopes',
        callback_data: 'category:hopes',
      },
    ]);

    // Member rows (3 per row)
    const memberButtons = members.map(m => ({
      text: m.displayName,
      callback_data: `user:${m.username}`,
    }));
    
    for (let i = 0; i < memberButtons.length; i += 3) {
      keyboard.push(memberButtons.slice(i, i + 3));
    }

    // Cancel row
    keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

    return keyboard;
  }
}

export default ToggleCategory;
