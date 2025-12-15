/**
 * Process Revision Input Use Case
 * @module nutribot/application/usecases/ProcessRevisionInput
 * 
 * Processes user's revision text and updates the pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { ConversationState } from '../../../domain/entities/ConversationState.mjs';

/**
 * Process revision input use case
 */
export class ProcessRevisionInput {
  #messagingGateway;
  #aiGateway;
  #nutrilogRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {string} input.text - Revision instructions
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, text, messageId } = input;

    this.#logger.debug('processRevision.start', { conversationId });

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

      // 2. Delete user's revision message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore
        }
      }

      // 3. Load current log
      let nutriLog = null;
      if (this.#nutrilogRepository) {
        nutriLog = await this.#nutrilogRepository.findByUuid(logUuid);
      }

      if (!nutriLog) {
        return { success: false, error: 'Log not found' };
      }

      // 4. Call AI to apply revisions
      const prompt = this.#buildRevisionPrompt(nutriLog.items, text);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 1000 });

      // 5. Parse revised items
      const revisedItems = this.#parseRevisionResponse(response);

      if (revisedItems.length === 0) {
        await this.#messagingGateway.sendMessage(
          conversationId,
          '❓ I couldn\'t understand that revision. Try being more specific.',
          {}
        );
        return { success: false, error: 'Could not parse revision' };
      }

      // 6. Update log with revised items
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.updateItems(logUuid, revisedItems);
      }

      // 7. Update state back to confirmation
      if (this.#conversationStateStore) {
        const newState = ConversationState.create(conversationId, {
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: logUuid },
        });
        await this.#conversationStateStore.set(conversationId, newState);
      }

      // 8. Show revised items with buttons
      const foodList = this.#formatFoodList(revisedItems);
      const buttons = this.#buildActionButtons(logUuid);

      // Update or send new message
      if (state.originalMessageId) {
        await this.#messagingGateway.updateMessage(conversationId, state.originalMessageId, {
          text: `✏️ Revised:\n\n${foodList}`,
          choices: buttons,
          inline: true,
        });
      } else {
        await this.#messagingGateway.sendMessage(conversationId, `✏️ Revised:\n\n${foodList}`, {
          choices: buttons,
          inline: true,
        });
      }

      this.#logger.info('processRevision.complete', { 
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
      this.#logger.error('processRevision.error', { conversationId, error: error.message });
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
2. Keep unchanged items as-is
3. Re-estimate macros for any modified items

Current items:
${currentJson}

Respond in JSON format with the COMPLETE revised list:
{
  "items": [
    {
      "name": "food name",
      "quantity": 1,
      "unit": "piece|cup|tbsp|g|oz",
      "grams": 100,
      "calories": 150,
      "protein": 10,
      "carbs": 15,
      "fat": 5
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `Apply this revision: "${revisionText}"`,
      },
    ];
  }

  /**
   * Parse revision response and transform to FoodItem format
   * @private
   */
  #parseRevisionResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const rawItems = data.items || [];
        
        // Transform AI response items into domain FoodItem format
        return rawItems.map(item => ({
          id: uuidv4(),
          label: item.name || item.label || 'Unknown',
          grams: item.grams || this.#estimateGrams(item),
          unit: item.unit || 'serving',
          amount: item.quantity || item.amount || 1,
          color: this.#normalizeNoomColor(item.noom_color || item.color),
          // Preserve extra data for display
          calories: item.calories || 0,
          icon: item.icon || 'default',
        }));
      }
      return [];
    } catch (e) {
      this.#logger.warn('processRevision.parseError', { error: e.message });
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
      'cup': 240,
      'piece': 50,
      'slice': 30,
      'oz': 28,
      'tbsp': 15,
      'tsp': 5,
      'serving': 100,
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
   * Format food list for display
   * @private
   */
  #formatFoodList(items) {
    return items.map(item => {
      const qty = item.amount || item.quantity || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      return `• ${qty} ${unit} ${item.label || item.name} (${cals} cal)`;
    }).join('\n');
  }

  /**
   * Build action buttons
   * @private
   */
  #buildActionButtons(logUuid) {
    return [
      [
        { text: '✅ Accept', callback_data: `accept:${logUuid}` },
        { text: '✏️ Revise', callback_data: `revise:${logUuid}` },
        { text: '🗑️ Discard', callback_data: `discard:${logUuid}` },
      ],
    ];
  }
}

export default ProcessRevisionInput;
