/**
 * Log Food From Image Use Case
 * @module nutribot/application/usecases/LogFoodFromImage
 * 
 * Detects food from an image and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Log food from image use case
 */
export class LogFoodFromImage {
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
   * @param {Object} input.imageData - { fileId } or { url } or { base64 }
   * @param {string} [input.messageId]
   */
  async execute(input) {
    const { userId, conversationId, imageData, messageId } = input;

    this.#logger.debug('logImage.start', { conversationId });

    try {
      // 1. Delete original user message (if provided)
      if (messageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // 2. Send "Analyzing..." message with thumbnail
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '🔍 Analyzing your food...',
        {}
      );

      // 3. Get image URL/data for AI
      let imageUrl = imageData.url;
      if (imageData.fileId && this.#messagingGateway.getFileUrl) {
        imageUrl = await this.#messagingGateway.getFileUrl(imageData.fileId);
      }

      // 4. Call AI for food detection
      const prompt = this.#buildDetectionPrompt();
      const response = await this.#aiGateway.chatWithImage(prompt, imageUrl, {
        maxTokens: 1000,
      });

      // 5. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: '❓ I couldn\'t identify any food in this image. Could you describe what you\'re eating?',
        });
        return { success: false, error: 'No food detected' };
      }

      // 6. Create log data object (plain object, not domain entity)
      const nutriLog = {
        uuid: uuidv4(),
        chatId: conversationId,
        items: foodItems,
        source: 'image',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      // 7. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 8. Update conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.set(conversationId, {
          flow: 'food_confirmation',
          pendingLogUuid: nutriLog.uuid,
        });
      }

      // 9. Update message with food list and buttons
      const foodList = this.#formatFoodList(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.uuid);

      await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
        text: `📸 I detected:\n\n${foodList}`,
        choices: buttons,
        inline: true,
      });

      this.#logger.info('logImage.complete', { 
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
      this.#logger.error('logImage.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Build detection prompt
   * @private
   */
  #buildDetectionPrompt() {
    return [
      {
        role: 'system',
        content: `You are a nutrition analyzer. Given an image of food:
1. Identify each food item visible
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

Be conservative with estimates. If uncertain, give ranges or note uncertainty.`,
      },
      {
        role: 'user',
        content: 'What food do you see in this image? Provide nutrition estimates.',
      },
    ];
  }

  /**
   * Parse AI response into food items
   * @private
   */
  #parseFoodResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return data.items || [];
      }
      return [];
    } catch (e) {
      this.#logger.warn('logImage.parseError', { error: e.message });
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

export default LogFoodFromImage;
