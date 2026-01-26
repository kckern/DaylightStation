/**
 * Log Food From Image Use Case
 * @module nutribot/usecases/LogFoodFromImage
 *
 * Detects food from an image and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { NutriLog } from '../../../1_domains/nutrition/entities/NutriLog.mjs';
import { formatFoodList, formatDateHeader } from '../../../1_domains/nutrition/entities/formatters.mjs';

/**
 * Log food from image use case
 */
export class LogFoodFromImage {
  #messagingGateway;
  #aiGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;
  #foodIconsString;
  #imageProcessor;

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
    this.#foodIconsString = deps.foodIconsString || 'apple banana bread cheese chicken default';
    this.#imageProcessor = deps.imageProcessor; // Optional: for downloading/processing images
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || this.#config?.weather?.timezone || 'America/Los_Angeles';
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      // If responseContext already has getFileUrl, use it directly
      // Don't spread - it breaks private field access (#adapter)
      if (responseContext.getFileUrl) {
        return responseContext;
      }
      // Otherwise, wrap with bound getFileUrl from gateway
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        sendPhoto: (src, options) => responseContext.sendPhoto(src, options),
        updateMessage: (msgId, updates) => responseContext.updateMessage(msgId, updates),
        deleteMessage: (msgId) => responseContext.deleteMessage(msgId),
        getFileUrl: this.#messagingGateway?.getFileUrl?.bind(this.#messagingGateway),
      };
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      sendPhoto: (src, options) => this.#messagingGateway.sendPhoto(conversationId, src, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
      getFileUrl: this.#messagingGateway?.getFileUrl?.bind(this.#messagingGateway),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, imageData, messageId: userMessageId, responseContext } = input;

    this.#logger.debug?.('logImage.start', { conversationId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 0. Clean up lingering status messages
      if (this.#conversationStateStore) {
        try {
          const existingState = await this.#conversationStateStore.get(conversationId);
          const oldStatusMsgId = existingState?.flowState?.statusMessageId;
          if (oldStatusMsgId) {
            try {
              await messaging.deleteMessage( oldStatusMsgId);
            } catch (e) {
              this.#logger.debug?.('logImage.deleteOldStatus.failed', { error: e.message });
            }
          }
        } catch (e) {
          this.#logger.debug?.('logImage.cleanupState.failed', { error: e.message });
        }
      }

      // 1. Send "Analyzing..." status message
      const { messageId: statusMsgId } = await messaging.sendMessage( `🔍 Analyzing image for nutrition...`, {});

      // 2. Get image URL/data for AI
      let imageUrl = imageData.url;
      if (imageData.fileId && messaging.getFileUrl) {
        imageUrl = await messaging.getFileUrl(imageData.fileId);
      }

      // 2b. Process image if processor available
      let imageForAI = imageUrl;
      if (this.#imageProcessor && imageUrl?.startsWith('http')) {
        try {
          const base64Image = await this.#imageProcessor.downloadAndProcess(imageUrl);
          if (base64Image) {
            imageForAI = base64Image;
          }
        } catch (e) {
          this.#logger.warn?.('logImage.download.failed', { error: e.message });
        }
      }

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt();
      const response = await this.#aiGateway.chatWithImage(prompt, imageForAI, { maxTokens: 1000 });

      // 4. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        await messaging.updateMessage( statusMsgId, {
          text: "❓ I couldn't identify any food in this image. Could you describe what you're eating?",
        });
        return { success: false, error: 'No food detected' };
      }

      // 5. Create NutriLog domain entity
      const timezone = this.#getTimezone();
      const now = new Date();
      const localDate = now.toLocaleDateString('en-CA', { timeZone: timezone });
      const localHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));

      let mealTime = 'morning';
      if (localHour >= 11 && localHour < 14) mealTime = 'afternoon';
      else if (localHour >= 14 && localHour < 20) mealTime = 'evening';
      else if (localHour >= 20 || localHour < 5) mealTime = 'night';

      const nutriLog = NutriLog.create({
        userId: conversationId.split(':')[0] === 'cli' ? 'cli-user' : userId,
        conversationId,
        items: foodItems,
        meal: {
          date: localDate,
          time: mealTime,
        },
        metadata: {
          source: 'image',
          imageUrl: imageUrl,
        },
        timezone,
        timestamp: now,
      });

      // 6. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }

      // 7. Delete status message
      try {
        await messaging.deleteMessage( statusMsgId);
      } catch (e) {
        this.#logger.debug?.('logImage.deleteStatus.failed', { error: e.message });
      }

      // 8. Send photo message with food list as caption
      const caption = this.#formatFoodCaption(foodItems, nutriLog.date || localDate);
      const buttons = this.#buildActionButtons(nutriLog.id);

      const { messageId: photoMsgId } = await messaging.sendPhoto(imageData.fileId || imageUrl, caption, {
        choices: buttons,
        inline: true,
      });

      // Delete user's original image
      if (userMessageId) {
        try {
          await messaging.deleteMessage( userMessageId);
        } catch (e) {
          this.#logger.debug?.('logImage.deleteUserMessage.failed', { error: e.message });
        }
      }

      // Update NutriLog with messageId
      if (this.#foodLogStore && photoMsgId) {
        const updatedLog = nutriLog.with({
          metadata: { ...nutriLog.metadata, messageId: String(photoMsgId) },
        }, new Date());
        await this.#foodLogStore.save(updatedLog);
      }

      this.#logger.info?.('logImage.complete', {
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
      this.#logger.error?.('logImage.error', { conversationId, error: error.message });
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
1. Identify each food item visible.
2. Break down composite foods into individual ingredients where reasonable.
3. Estimate portion sizes in grams or common measures for each component.
4. Estimate macros (calories, protein, carbs, fat) and micronutrients for each item.
5. Assign a noom_color: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density).
6. Select the best matching icon from this list: ${this.#foodIconsString}
7. Use Title Case for all food names.

Respond in JSON format:
{
  "items": [
    {
      "name": "Food Name In Title Case",
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

Be conservative with estimates.`,
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
      this.#logger.warn?.('logImage.parseError', { error: e.message });
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
    const normalized = String(color || 'yellow').toLowerCase();
    if (['green', 'yellow', 'orange', 'red'].includes(normalized)) {
      return normalized === 'red' ? 'orange' : normalized;
    }
    return 'yellow';
  }

  /**
   * Format food caption for image message
   * @private
   */
  #formatFoodCaption(items, date) {
    const dateHeader = date ? formatDateHeader(date, { timezone: this.#getTimezone() }) : '';
    const foodList = formatFoodList(items);
    return `${dateHeader}\n\n${foodList}`;
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

export default LogFoodFromImage;
