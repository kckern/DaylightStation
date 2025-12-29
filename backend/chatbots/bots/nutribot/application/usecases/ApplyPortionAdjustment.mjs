/**
 * Apply Portion Adjustment Use Case
 * @module nutribot/application/usecases/ApplyPortionAdjustment
 * 
 * Applies a portion scaling factor to a food item.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';

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
    const { userId, conversationId, messageId, factor, itemId: inputItemId } = input;

    this.#logger.debug('adjustment.applyFactor', { userId, factor, itemId: inputItemId });

    try {
      // 1. Get itemId from input or fallback to state
      let itemId = inputItemId;
      let date = null;
      if (!itemId && this.#conversationStateStore?.get) {
        const state = await this.#conversationStateStore.get(conversationId);
        itemId = state?.flowState?.itemId;
        date = state?.flowState?.date;
      }

      if (!itemId) {
        throw new Error('No item selected in adjustment state');
      }

      // 2. Find the item in nutrilist
      let item = null;
      if (this.#nutrilistRepository?.findByUuid) {
        item = await this.#nutrilistRepository.findByUuid(userId, itemId);
      }
      if (!item && this.#nutrilistRepository?.getAll) {
        const allItems = this.#nutrilistRepository.getAll();
        item = allItems.find(i => i.id === itemId || i.uuid === itemId);
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
        this.#logger.debug('adjustment.callingRepositoryUpdate', {
          userId,
          itemId,
          factor,
          scaledValues: {
            grams: scaledItem.grams,
            calories: scaledItem.calories,
            protein: scaledItem.protein,
            carbs: scaledItem.carbs,
            fat: scaledItem.fat
          }
        });
        
        const updatedItem = await this.#nutrilistRepository.update(userId, itemId, scaledItem);
        
        this.#logger.info('adjustment.repositoryUpdateComplete', {
          userId,
          itemId,
          updatedValues: {
            grams: updatedItem.grams,
            calories: updatedItem.calories,
            protein: updatedItem.protein
          }
        });
        
        // Verify the update was successful
        if (updatedItem.grams !== scaledItem.grams || updatedItem.calories !== scaledItem.calories) {
          this.#logger.error('adjustment.updateVerificationFailed', {
            userId,
            itemId,
            expected: { grams: scaledItem.grams, calories: scaledItem.calories },
            actual: { grams: updatedItem.grams, calories: updatedItem.calories }
          });
          throw new Error('Repository update verification failed - values do not match');
        }
      } else if (this.#nutrilistRepository?.save) {
        this.#logger.warn('adjustment.usingLegacySave', { userId, itemId });
        await this.#nutrilistRepository.save(scaledItem);
      } else {
        this.#logger.error('adjustment.noRepositoryMethod', { userId, itemId });
        throw new Error('No repository update or save method available');
      }

      // 5. Don't clear state yet - user might want to make more adjustments
      // State is preserved so "More Adjustments" can return to the same day

      // 6. Update message with confirmation (NOT delete + new)
      const name = item.name || item.label || 'Item';
      const factorText = factor < 1 ? `reduced to ${Math.round(factor * 100)}%` : `increased to ${Math.round(factor * 100)}%`;
      const confirmationText = `✅ <b>${name}</b> ${factorText}\n${originalGrams}g → ${scaledItem.grams}g (${originalCalories} → ${scaledItem.calories} cal)`;
      
      if (messageId) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          caption: confirmationText,
          parseMode: 'HTML',
          choices: [
            [
              { text: '✏️ More Adjustments', callback_data: encodeCallback('bi') },
              { text: '✅ Done', callback_data: encodeCallback('dn') },
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
                { text: '✏️ More Adjustments', callback_data: encodeCallback('bi') },
                { text: '✅ Done', callback_data: encodeCallback('dn') },
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
        newGrams: scaledItem.grams,
        confirmationMessage: confirmationText
      });

      return { success: true, scaledGrams: scaledItem.grams, originalGrams };
    } catch (error) {
      this.#logger.error('adjustment.applyFactor.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ApplyPortionAdjustment;
