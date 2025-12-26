/**
 * Log Food From Image Use Case
 * @module nutribot/application/usecases/LogFoodFromImage
 * 
 * Detects food from an image and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { createCanvas, loadImage } from 'canvas';
import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
import { FOOD_ICONS_STRING } from '../constants/foodIcons.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';
import NutriLog from '../../domain/NutriLog.mjs';
import { formatFoodList, formatDateHeader } from '../../domain/formatters.mjs';

/**
 * Log food from image use case
 */
export class LogFoodFromImage {
  #messagingGateway;
  #aiGateway;
  #nutrilogRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutrilogRepository = deps.nutrilogRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
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
      // 0. Clean up any lingering status messages from previous requests
      if (this.#conversationStateStore) {
        try {
          const existingState = await this.#conversationStateStore.get(conversationId);
          const oldStatusMsgId = existingState?.flowState?.statusMessageId;
          if (oldStatusMsgId) {
            try {
              await this.#messagingGateway.deleteMessage(conversationId, oldStatusMsgId);
            } catch (e) {
              // Ignore - message may already be deleted
            }
          }
        } catch (e) {
          // Ignore state retrieval errors
        }
      }

      // 1. Send "Analyzing..." status message
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
            `🔍 Analyzing image for nutrition...`,
        {}
      );

      // 2. Get image URL/data for AI
      let imageUrl = imageData.url;
      if (imageData.fileId && this.#messagingGateway.getFileUrl) {
        imageUrl = await this.#messagingGateway.getFileUrl(imageData.fileId);
      }

      // 2b. Download image, resize to 720p, convert to base64
      // This avoids OpenAI timeout issues with slow external URLs (e.g., IFTTT locker)
      let imageForAI = imageUrl;
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          this.#logger.debug('logImage.download.start', { url: imageUrl.substring(0, 100) });
          const base64Image = await this.#downloadAndProcessImage(imageUrl);
          if (base64Image) {
            imageForAI = base64Image;
            this.#logger.debug('logImage.download.success', { base64Length: base64Image.length });
          }
        } catch (downloadError) {
          this.#logger.warn('logImage.download.failed', { error: downloadError.message });
          // Fall back to original URL if download fails
        }
      }

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt();
      const response = await this.#aiGateway.chatWithImage(prompt, imageForAI, {
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
      // Use local date/time based on timezone, not UTC
      const timezone = this.#getTimezone();
      const now = new Date();
      const localDate = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format
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
      });

      // 6. Save NutriLog
      if (this.#nutrilogRepository) {
        await this.#nutrilogRepository.save(nutriLog);
      }

      // 7. Delete status message and user's original image, then send photo response
      // Delete status message first
      try {
        await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
      } catch (e) {
        // Ignore delete errors
      }

      // 9. Send photo message with food list as caption and buttons
      // Use file_id (not URL) to avoid expiration issues
      const caption = this.#formatFoodCaption(foodItems, nutriLog.date || localDate);
      const buttons = this.#buildActionButtons(nutriLog.id);

      const { messageId: photoMsgId } = await this.#messagingGateway.sendPhoto(
        conversationId,
        imageData.fileId || imageUrl,  // Prefer file_id over URL
        {
          caption,
          choices: buttons,
          inline: true,
        }
      );

      // Now delete user's original image (after our response is posted)
      if (userMessageId) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, userMessageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // Update NutriLog with the messageId for later UI updates (e.g., auto-accept)
      if (this.#nutrilogRepository && photoMsgId) {
        const updatedLog = nutriLog.with({
          metadata: { ...nutriLog.metadata, messageId: String(photoMsgId) },
        });
        await this.#nutrilogRepository.save(updatedLog);
      }

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
6. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")

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
          icon: item.icon || 'default',
          // Nutrition fields from AI
          calories: item.calories ?? 0,
          protein: item.protein ?? 0,
          carbs: item.carbs ?? 0,
          fat: item.fat ?? 0,
          fiber: item.fiber ?? 0,
          sugar: item.sugar ?? 0,
          sodium: item.sodium ?? 0,
          cholesterol: item.cholesterol ?? 0,
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
        { text: '✅ Accept', callback_data: encodeCallback('a', { id: logUuid }) },
        { text: '✏️ Revise', callback_data: encodeCallback('r', { id: logUuid }) },
        { text: '🗑️ Discard', callback_data: encodeCallback('x', { id: logUuid }) },
      ],
    ];
  }

  /**
   * Download image from URL, resize to ~720p, convert to base64 data URL
   * @private
   * @param {string} url - Image URL to download
   * @returns {Promise<string|null>} Base64 data URL or null on failure
   */
  async #downloadAndProcessImage(url) {
    try {
      // Download image with timeout
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000, // 15 second timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NutriBot/1.0)',
        },
      });

      const imageBuffer = Buffer.from(response.data);
      
      // Load image with canvas
      const img = await loadImage(imageBuffer);
      const { width, height } = img;
      
      // Calculate new dimensions (target ~720p, max dimension 1280)
      const maxDimension = 1280;
      let newWidth = width;
      let newHeight = height;
      
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          newWidth = maxDimension;
          newHeight = Math.round(height * (maxDimension / width));
        } else {
          newHeight = maxDimension;
          newWidth = Math.round(width * (maxDimension / height));
        }
      }
      
      // Create canvas and draw resized image
      const canvas = createCanvas(newWidth, newHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      
      // Convert to JPEG base64 data URL
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      this.#logger.debug('logImage.processed', {
        originalSize: imageBuffer.length,
        originalDimensions: `${width}x${height}`,
        newDimensions: `${newWidth}x${newHeight}`,
      });
      
      return dataUrl;
    } catch (error) {
      this.#logger.error('logImage.download.error', { 
        url: url.substring(0, 100),
        error: error.message,
      });
      return null;
    }
  }
}

export default LogFoodFromImage;
