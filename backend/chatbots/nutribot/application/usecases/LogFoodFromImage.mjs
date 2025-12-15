/**
 * Log Food From Image Use Case
 * @module nutribot/application/usecases/LogFoodFromImage
 * 
 * Detects food from an image and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { FOOD_ICONS_STRING } from '../constants/foodIcons.mjs';
import { ConversationState } from '../../../domain/entities/ConversationState.mjs';
import NutriLog from '../../domain/NutriLog.mjs';

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
    const { userId, conversationId, imageData, messageId: userMessageId } = input;

    this.#logger.debug('logImage.start', { conversationId });

    try {
      // 1. Send "Analyzing..." status message
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '🔍 Analyzing your food...',
        {}
      );

      // 2. Get image URL/data for AI
      let imageUrl = imageData.url;
      if (imageData.fileId && this.#messagingGateway.getFileUrl) {
        imageUrl = await this.#messagingGateway.getFileUrl(imageData.fileId);
      }

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt();
      const response = await this.#aiGateway.chatWithImage(prompt, imageUrl, {
        maxTokens: 1000,
      });

      // 4. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: '❓ I couldn\'t identify any food in this image. Could you describe what you\'re eating?',
        });
        return { success: false, error: 'No food detected' };
      }

      // 5. Create NutriLog domain entity
      const today = new Date().toISOString().split('T')[0];
      const hour = new Date().getHours();
      let mealTime = 'morning';
      if (hour >= 11 && hour < 14) mealTime = 'afternoon';
      else if (hour >= 14 && hour < 20) mealTime = 'evening';
      else if (hour >= 20 || hour < 5) mealTime = 'night';
      
      const nutriLog = NutriLog.create({
        userId: conversationId.split(':')[0] === 'cli' ? 'cli-user' : userId,
        conversationId,
        items: foodItems,
        meal: {
          date: today,
          time: mealTime,
        },
        metadata: {
          source: 'image',
          imageUrl: imageUrl,
        },
      });

      // 6. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 7. Update conversation state
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: nutriLog.id },
        });
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 8. Delete user's original message and status message
      if (userMessageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, userMessageId);
        } catch (e) {
          // Ignore delete errors
        }
      }
      try {
        await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
      } catch (e) {
        // Ignore delete errors
      }

      // 9. Send image message with food list as caption and buttons
      const caption = this.#formatFoodCaption(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.id);

      const { messageId: photoMsgId } = await this.#messagingGateway.sendPhoto(
        conversationId,
        imageUrl,
        {
          caption,
          choices: buttons,
          inline: true,
        }
      );

      this.#logger.info('logImage.complete', { 
        conversationId, 
        itemCount: foodItems.length,
        logUuid: nutriLog.id,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.id,
        messageId: photoMsgId,
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
3. Estimate macros (calories, protein, carbs, fat) and micronutrients (fiber, sugar, sodium, cholesterol) for each item
4. Assign a noom_color: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Select the best matching icon from this list: ${FOOD_ICONS_STRING}

Respond in JSON format:
{
  "items": [
    {
      "name": "food name",
      "icon": "chicken",
      "noom_color": "yellow",
      "quantity": 1,
      "unit": "piece|cup|tbsp|g|oz",
      "grams": 100,
      "calories": 150,
      "protein": 10,
      "carbs": 15,
      "fat": 5,
      "fiber": 2,
      "sugar": 3,
      "sodium": 200,
      "cholesterol": 25
    }
  ]
}

Noom colors:
- green: lowest calorie density (vegetables, fruits, lean proteins)
- yellow: moderate calorie density (grains, legumes, lean meats)
- orange: highest calorie density (nuts, oils, sweets, fried foods)

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
        const rawItems = data.items || [];
        
        // Transform AI response items into domain FoodItem format
        const items = rawItems.map(item => ({
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
        
        return items;
      }
      return [];
    } catch (e) {
      this.#logger.warn('logImage.parseError', { error: e.message });
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
      'cup': 240, 'piece': 50, 'slice': 30, 'oz': 28,
      'tbsp': 15, 'tsp': 5, 'serving': 100,
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
    const normalized = String(color || 'yellow').toLowerCase();
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
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      return `• ${qty} ${unit} ${item.name} (${cals} cal)`;
    }).join('\n');
  }

  /**
   * Format food caption for image message (with icons and colors)
   * @private
   */
  #formatFoodCaption(items) {
    const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' };
    const totalCal = items.reduce((sum, i) => sum + (i.calories || 0), 0);
    
    const lines = items.map(item => {
      const emoji = colorEmoji[item.noom_color] || '⚪';
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      return `${emoji} ${qty} ${unit} ${item.name} (${cals} cal)`;
    });
    
    return `📸 Detected ${items.length} item${items.length !== 1 ? 's' : ''} (${totalCal} cal total)\n\n${lines.join('\n')}`;
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
