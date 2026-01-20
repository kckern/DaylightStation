/**
 * Apply Portion Adjustment Use Case
 * @module nutribot/usecases/ApplyPortionAdjustment
 *
 * Applies a portion scaling factor to a food item.
 */

/**
 * Apply portion adjustment use case
 */
export class ApplyPortionAdjustment {
  #messagingGateway;
  #conversationStateStore;
  #nutriListStore;
  #generateDailyReport;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#generateDailyReport = deps.generateDailyReport;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, messageId, factor, itemId: inputItemId } = input;

    this.#logger.debug?.('adjustment.applyFactor', { userId, factor, itemId: inputItemId });

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
      if (this.#nutriListStore?.findByUuid) {
        item = await this.#nutriListStore.findByUuid(userId, itemId);
      }
      if (!item && this.#nutriListStore?.findAll) {
        const allItems = await this.#nutriListStore.findAll(userId);
        item = allItems.find((i) => i.id === itemId || i.uuid === itemId);
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
      if (this.#nutriListStore?.update) {
        this.#logger.debug?.('adjustment.callingStoreUpdate', {
          userId,
          itemId,
          factor,
          scaledValues: {
            grams: scaledItem.grams,
            calories: scaledItem.calories,
          },
        });

        const updatedItem = await this.#nutriListStore.update(userId, itemId, scaledItem);

        this.#logger.info?.('adjustment.storeUpdateComplete', {
          userId,
          itemId,
          updatedValues: {
            grams: updatedItem.grams,
            calories: updatedItem.calories,
          },
        });

        // Verify the update
        if (updatedItem.grams !== scaledItem.grams || updatedItem.calories !== scaledItem.calories) {
          this.#logger.error?.('adjustment.updateVerificationFailed', {
            userId,
            itemId,
            expected: { grams: scaledItem.grams, calories: scaledItem.calories },
            actual: { grams: updatedItem.grams, calories: updatedItem.calories },
          });
          throw new Error('Store update verification failed');
        }
      } else if (this.#nutriListStore?.save) {
        this.#logger.warn?.('adjustment.usingLegacySave', { userId, itemId });
        await this.#nutriListStore.save(scaledItem);
      } else {
        this.#logger.error?.('adjustment.noStoreMethod', { userId, itemId });
        throw new Error('No store update or save method available');
      }

      // 5. Update message with confirmation
      const name = item.name || item.label || 'Item';
      const factorText = factor < 1 ? `reduced to ${Math.round(factor * 100)}%` : `increased to ${Math.round(factor * 100)}%`;
      const confirmationText = `✅ <b>${name}</b> ${factorText}\n${originalGrams}g → ${scaledItem.grams}g (${originalCalories} → ${scaledItem.calories} cal)`;

      if (messageId) {
        await this.#messagingGateway.updateMessage(conversationId, messageId, {
          caption: confirmationText,
          parseMode: 'HTML',
          choices: [
            [
              { text: '✏️ More Adjustments', callback_data: this.#encodeCallback('bi') },
              { text: '✅ Done', callback_data: this.#encodeCallback('dn') },
            ],
          ],
          inline: true,
        });
      } else {
        await this.#messagingGateway.sendMessage(conversationId, confirmationText, {
          parseMode: 'HTML',
          choices: [
            [
              { text: '✏️ More Adjustments', callback_data: this.#encodeCallback('bi') },
              { text: '✅ Done', callback_data: this.#encodeCallback('dn') },
            ],
          ],
          inline: true,
        });
      }

      this.#logger.info?.('adjustment.factorApplied', {
        userId,
        itemId,
        factor,
        oldGrams: originalGrams,
        newGrams: scaledItem.grams,
      });

      return { success: true, scaledGrams: scaledItem.grams, originalGrams };
    } catch (error) {
      this.#logger.error?.('adjustment.applyFactor.error', { userId, error: error.message });
      throw error;
    }
  }
}

export default ApplyPortionAdjustment;
