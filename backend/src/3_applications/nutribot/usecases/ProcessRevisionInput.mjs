/**
 * Process Revision Input Use Case
 * @module nutribot/usecases/ProcessRevisionInput
 *
 * Processes user's revision text and updates the pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { formatFoodList, formatDateHeader } from '#domains/nutrition/entities/formatters.mjs';

/**
 * Process revision input use case
 */
export class ProcessRevisionInput {
  #messagingGateway;
  #aiGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || this.#config?.weather?.timezone || 'America/Los_Angeles';
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, text, messageId } = input;

    this.#logger.debug?.('processRevision.start', { conversationId });

    try {
      // 1. Get current state
      let state = null;
      if (this.#conversationStateStore) {
        state = await this.#conversationStateStore.get(conversationId);
      }

      if (!state || state.activeFlow !== 'revision') {
        return { success: false, error: 'Not in revision mode' };
      }

      const logUuid = state.flowState?.pendingLogUuid;
      const originalMessageId = state.flowState?.originalMessageId;

      // 2. Delete user's revision message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 3. Show processing indicator on original message
      if (originalMessageId) {
        try {
          const processingButton = [[{ text: '⏳ Processing...', callback_data: 'noop' }]];
          await this.#messagingGateway.updateMessage(conversationId, originalMessageId, {
            choices: processingButton,
            inline: true,
          });
        } catch (e) {
          this.#logger.debug?.('processRevision.processingIndicator.failed', { error: e.message });
        }
      }

      // 4. Load current log
      let nutriLog = null;
      if (this.#foodLogStore) {
        nutriLog = await this.#foodLogStore.findByUuid(logUuid, userId);
      }

      if (!nutriLog) {
        return { success: false, error: 'Log not found' };
      }

      // 5. Call AI to apply revisions
      const prompt = this.#buildRevisionPrompt(nutriLog.items, text);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 1000 });

      // 6. Parse revised items
      const revisedItems = this.#parseRevisionResponse(response);

      if (revisedItems.length === 0) {
        await this.#messagingGateway.sendMessage(conversationId, "❓ I couldn't understand that revision. Try being more specific.", {});
        return { success: false, error: 'Could not parse revision' };
      }

      // 7. Update log with revised items
      if (this.#foodLogStore) {
        await this.#foodLogStore.updateItems(userId, logUuid, revisedItems);
      }

      // 8. Update state back to confirmation
      if (this.#conversationStateStore) {
        const newState = {
          conversationId,
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: logUuid },
        };
        await this.#conversationStateStore.set(conversationId, newState);
      }

      // 9. Show revised items with buttons
      const logDate = nutriLog.meal?.date || nutriLog.date;
      const dateHeader = logDate ? formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() }) : '';
      const foodList = formatFoodList(revisedItems);
      const buttons = this.#buildActionButtons(logUuid);
      const messageText = dateHeader ? `${dateHeader}\n\n${foodList}` : foodList;

      const isImageLog = nutriLog?.metadata?.source === 'image';
      const originalMessageId = state.flowState?.originalMessageId;
      if (originalMessageId) {
        const updatePayload = isImageLog ? { caption: messageText, choices: buttons, inline: true } : { text: messageText, choices: buttons, inline: true };
        await this.#messagingGateway.updateMessage(conversationId, originalMessageId, updatePayload);
      } else {
        await this.#messagingGateway.sendMessage(conversationId, messageText, {
          choices: buttons,
          inline: true,
        });
      }

      this.#logger.info?.('processRevision.complete', {
        conversationId,
        logUuid,
        itemCount: revisedItems.length,
      });

      return {
        success: true,
        logUuid,
        itemCount: revisedItems.length,
      };
    } catch (error) {
      this.#logger.error?.('processRevision.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Build revision prompt
   * @private
   */
  #buildRevisionPrompt(currentItems, revisionText) {
    const currentJson = JSON.stringify(currentItems, null, 2);

    return [
      {
        role: 'system',
        content: `You are a food log editor. Given the current food items and a revision instruction:
1. Apply the requested changes
2. Keep unchanged items as-is (including their noom_color)
3. Re-estimate macros for any modified items
4. Assign noom_color for new items: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")

Current items:
${currentJson}

Respond in JSON format with the COMPLETE revised list:
{
  "items": [
    {
      "name": "Food Name In Title Case",
      "noom_color": "green|yellow|orange",
      "quantity": 1,
      "unit": "piece|cup|tbsp|g|oz",
      "grams": 100,
      "calories": 150,
      "protein": 10,
      "carbs": 15,
      "fat": 5
    }
  ]
}

Noom colors:
- green: lowest calorie density (vegetables, fruits, lean proteins, whole grains)
- yellow: moderate calorie density (grains, legumes, lean meats, dairy)
- orange: highest calorie density (nuts, oils, sweets, fried foods, processed foods)`,
      },
      {
        role: 'user',
        content: `Apply this revision: "${revisionText}"`,
      },
    ];
  }

  /**
   * Parse revision response
   * @private
   */
  #parseRevisionResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const rawItems = data.items || [];

        return rawItems.map((item) => ({
          id: uuidv4(),
          label: item.name || item.label || 'Unknown',
          grams: item.grams || this.#estimateGrams(item),
          unit: item.unit || 'serving',
          amount: item.quantity || item.amount || 1,
          color: this.#normalizeNoomColor(item.noom_color || item.color),
          icon: item.icon || 'default',
          calories: item.calories ?? 0,
          protein: item.protein ?? 0,
          carbs: item.carbs ?? 0,
          fat: item.fat ?? 0,
          fiber: item.fiber ?? 0,
          sugar: item.sugar ?? 0,
          sodium: item.sodium ?? 0,
          cholesterol: item.cholesterol ?? 0,
        }));
      }
      return [];
    } catch (e) {
      this.#logger.warn?.('processRevision.parseError', { error: e.message });
      return [];
    }
  }

  /**
   * Estimate grams from item data
   * @private
   */
  #estimateGrams(item) {
    if (item.grams) return item.grams;
    if (item.calories) return Math.round(item.calories / 1.5);

    const unitDefaults = {
      cup: 240,
      piece: 50,
      slice: 30,
      oz: 28,
      tbsp: 15,
      tsp: 5,
      serving: 100,
    };

    const unit = (item.unit || 'serving').toLowerCase();
    const amount = item.quantity || item.amount || 1;
    return (unitDefaults[unit] || 100) * amount;
  }

  /**
   * Normalize Noom color
   * @private
   */
  #normalizeNoomColor(color) {
    if (!color) return 'yellow';
    const normalized = color.toLowerCase().trim();
    if (['green', 'yellow', 'orange', 'red'].includes(normalized)) {
      return normalized === 'red' ? 'orange' : normalized;
    }
    return 'yellow';
  }

  /**
   * Build action buttons
   * @private
   */
  #buildActionButtons(logUuid) {
    return [
      [
        { text: '✅ Accept', callback_data: this.#encodeCallback('a', { id: logUuid }) },
        { text: '✏️ Revise', callback_data: this.#encodeCallback('r', { id: logUuid }) },
        { text: '🗑️ Discard', callback_data: this.#encodeCallback('x', { id: logUuid }) },
      ],
    ];
  }
}

export default ProcessRevisionInput;
