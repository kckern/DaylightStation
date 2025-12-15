/**
 * Apply Portion Adjustment Use Case
 * @module nutribot/application/usecases/ApplyPortionAdjustment
 * 
 * Applies a portion scaling factor to a food item.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Apply portion adjustment use case
 */
export class ApplyPortionAdjustment {
  #messagingGateway;
  #conversationStateStore;
  #nutrilistRepository;
  #generateDailyReport;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutrilistRepository = deps.nutrilistRepository;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, factor } = input;

    this.#logger.debug('adjustment.applyFactor', { userId, factor });

    try {
      // 1. Get current state to find the itemId
      let itemId = null;
      let date = null;
      if (this.#conversationStateStore?.get) {
        const state = await this.#conversationStateStore.get(conversationId);
        itemId = state?.data?.itemId;
        date = state?.data?.date;
      }

      if (!itemId) {
        throw new Error('No item selected in adjustment state');
      }

      // 2. Find the item in nutrilist
      let item = null;
      if (this.#nutrilistRepository?.findById) {
        item = await this.#nutrilistRepository.findById(itemId);
      }
      if (!item && this.#nutrilistRepository?.getAll) {
        const allItems = this.#nutrilistRepository.getAll();
        item = allItems.find(i => i.id === itemId);
      }

      if (!item) {
        throw new Error('Item not found');
      }

      const originalGrams = item.grams || 0;
      const originalCalories = item.calories || 0;
      const originalProtein = item.protein || 0;
      const originalCarbs = item.carbs || 0;
      const originalFat = item.fat || 0;

      // 3. Calculate scaled values
      const scaledItem = {
        ...item,
        grams: Math.round(originalGrams * factor),
        calories: Math.round(originalCalories * factor),
        protein: Math.round(originalProtein * factor),
        carbs: Math.round(originalCarbs * factor),
        fat: Math.round(originalFat * factor),
      };

      // 4. Update the item in nutrilist
      if (this.#nutrilistRepository?.update) {
        await this.#nutrilistRepository.update(itemId, scaledItem);
      } else if (this.#nutrilistRepository?.save) {
        await this.#nutrilistRepository.save(scaledItem);
      }

      // 5. Don't clear state yet - user might want to make more adjustments
      // State is preserved so "More Adjustments" can return to the same day

      // 6. Update message with confirmation (NOT delete + new)
      const name = item.name || item.label || 'Item';
      const factorText = factor < 1 ? `reduced to ${Math.round(factor * 100)}%` : `increased to ${Math.round(factor * 100)}%`;
      const confirmationText = `✅ <b>${name}</b> ${factorText}\n${originalGrams}g → ${scaledItem.grams}g (${originalCalories} → ${scaledItem.calories} cal)`;
      
      if (messageId) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          text: confirmationText,
          parseMode: 'HTML',
          choices: [
            [
              { text: '✏️ More Adjustments', callback_data: 'adj_back_items' },
              { text: '✅ Done', callback_data: 'adj_done' },
            ],
          ],
          inline: true,
        });
      } else {
        // Fallback: send new message if no messageId
        await this.#messagingGateway.sendMessage(
          conversationId,
          confirmationText,
          { 
            parseMode: 'HTML',
            choices: [
              [
                { text: '✏️ More Adjustments', callback_data: 'adj_back_items' },
                { text: '✅ Done', callback_data: 'adj_done' },
              ],
            ],
            inline: true,
          }
        );
      }

      // 7. Report regeneration is now triggered by user pressing "Done" button

      this.#logger.info('adjustment.factorApplied', { 
        userId, 
        itemId, 
        factor, 
        oldGrams: originalGrams, 
        newGrams: scaledItem.grams 
      });

      return { success: true, scaledGrams: scaledItem.grams, originalGrams };
    } catch (error) {
      this.#logger.error('adjustment.applyFactor.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ApplyPortionAdjustment;
