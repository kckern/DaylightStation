/**
 * Log Food From Text Use Case
 * @module nutribot/application/usecases/LogFoodFromText
 * 
 * Detects food from text description and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Log food from text use case
 */
export class LogFoodFromText {
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
   * @param {string} input.text
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, text, messageId } = input;

    this.#logger.debug('logText.start', { conversationId, textLength: text.length });

    try {
      // 1. Delete original user message
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // 2. Send "Analyzing..." message
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '🔍 Analyzing...',
        {}
      );

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt(text);
      const response = await this.#aiGateway.chat(prompt, {
        maxTokens: 1000,
      });

      // 4. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: '❓ I couldn\'t identify any food from your description. Could you be more specific?',
        });
        return { success: false, error: 'No food detected' };
      }

      // 5. Create log data object
      const nutriLog = {
        uuid: uuidv4(),
        chatId: conversationId,
        items: foodItems,
        source: 'text',
        sourceText: text,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // 6. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 7. Update conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.set(conversationId, {
          flow: 'food_confirmation',
          pendingLogUuid: nutriLog.uuid,
        });
      }

      // 8. Update message with food list and buttons
      const foodList = this.#formatFoodList(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.uuid);

      await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
        text: `📝 Got it! Here's what I understood:\n\n${foodList}`,
        choices: buttons,
        inline: true,
      });

      this.#logger.info('logText.complete', { 
        conversationId, 
        itemCount: foodItems.length,
        logUuid: nutriLog.uuid,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.uuid,
        messageId: statusMsgId,
        itemCount: foodItems.length,
      };
    } catch (error) {
      this.#logger.error('logText.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Build detection prompt
   * @private
   */
  #buildDetectionPrompt(userText) {
    return [
      {
        role: 'system',
        content: `You are a nutrition analyzer. Given a food description:
1. Identify each food item mentioned
2. Estimate portion sizes in grams or common measures
3. Estimate macros (calories, protein, carbs, fat) for each item

Respond in JSON format:
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
}

Be conservative with estimates. Use USDA values when possible.`,
      },
      {
        role: 'user',
        content: `Parse this food description: "${userText}"`,
      },
    ];
  }

  /**
   * Parse AI response into food items
   * @private
   */
  #parseFoodResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return data.items || [];
      }
      return [];
    } catch (e) {
      this.#logger.warn('logText.parseError', { error: e.message });
      return [];
    }
  }

  /**
   * Format food list for display
   * @private
   */
  #formatFoodList(items) {
    return items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      return `• ${qty} ${unit} ${item.name} (${cals} cal)`;
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

export default LogFoodFromText;
