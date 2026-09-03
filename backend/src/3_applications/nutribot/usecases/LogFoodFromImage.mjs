/**
 * Log Food From Image Use Case
 * @module nutribot/usecases/LogFoodFromImage
 *
 * Detects food from an image and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { formatFoodList, formatDateHeader, formatLoggedSummary } from '#domains/nutrition/entities/formatters.mjs';
import { repairTruncatedJson } from '../lib/repairJson.mjs';
import { createNutriLog } from '../nutriLogRecords.mjs';
import { groupParsedItems } from '#domains/nutrition/services/groupParsedItems.mjs';

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
  #reconciliationReader;
  #catalogService;
  #imageDownloader;
  #photoStore;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.imageDownloader) throw new Error('imageDownloader is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
    this.#foodIconsString = deps.foodIconsString || 'apple banana bread cheese chicken default';
    this.#imageProcessor = deps.imageProcessor; // Optional: for downloading/processing images
    this.#reconciliationReader = deps.reconciliationReader || null;
    this.#catalogService = deps.catalogService || null;
    this.#imageDownloader = deps.imageDownloader;
    // Optional — persists the captured photo for later serving (Task 2.3).
    // Persistence failures must NEVER break food logging; see #persistPhoto.
    this.#photoStore = deps.photoStore || null;
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
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
      // Otherwise, wrap with bound methods from gateway
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        sendPhoto: (src, caption, options) => responseContext.sendPhoto(src, caption, options),
        updateMessage: (msgId, updates) => responseContext.updateMessage(msgId, updates),
        deleteMessage: (msgId) => responseContext.deleteMessage(msgId),
        getFileUrl: this.#messagingGateway?.getFileUrl?.bind(this.#messagingGateway),
      };
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      sendPhoto: (src, caption, options) => this.#messagingGateway.sendPhoto(conversationId, src, caption, options),
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

    this.#logger.info?.('logImage.start', {
      conversationId,
      userId,
      hasResponseContext: !!responseContext,
      hasImageUrl: !!imageData?.url,
      hasFileId: !!imageData?.fileId,
      imageUrl: imageData?.url?.substring(0, 120),
    });

    const messaging = this.#getMessaging(responseContext, conversationId);
    let photoMsgId = null;

    try {
      // 0. Clean up lingering status messages
      if (this.#conversationStateStore) {
        try {
          const existingState = await this.#conversationStateStore.get(conversationId);
          const oldStatusMsgId = existingState?.flowState?.statusMessageId;
          if (oldStatusMsgId) {
            try {
              await messaging.deleteMessage(oldStatusMsgId);
            } catch (e) {
              this.#logger.debug?.('logImage.deleteOldStatus.failed', { error: e.message });
            }
          }
        } catch (e) {
          this.#logger.debug?.('logImage.cleanupState.failed', { error: e.message });
        }
      }

      // 1. Resolve image URL
      let imageUrl = imageData.url;
      if (imageData.fileId && messaging.getFileUrl) {
        imageUrl = await messaging.getFileUrl(imageData.fileId);
      }

      // 2. Download image to buffer for sendPhoto
      let photoSource;
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          photoSource = await this.#imageDownloader.download(imageUrl);
        } catch (e) {
          this.#logger.warn?.('logImage.download.failed', { conversationId, error: e.message });
          photoSource = imageUrl; // Fallback to URL
        }
      } else {
        photoSource = imageUrl || imageData.fileId;
      }

      // 3. Send photo with analyzing caption as status
      ({ messageId: photoMsgId } = await messaging.sendPhoto(
        photoSource,
        '🔍 Analyzing image for nutrition...',
        {}
      ));

      // Delete user's original image (now that we've re-sent it)
      if (userMessageId) {
        try {
          await messaging.deleteMessage(userMessageId);
        } catch (e) {
          this.#logger.debug?.('logImage.deleteUserMessage.failed', { error: e.message });
        }
      }

      // 4. Process image for AI if processor available
      let imageForAI = photoSource;
      if (this.#imageProcessor && imageUrl?.startsWith('http')) {
        try {
          const base64Image = await this.#imageProcessor.downloadAndProcess(imageUrl);
          if (base64Image) {
            imageForAI = base64Image;
            this.#logger.info?.('logImage.imageProcessed', { conversationId, format: 'base64' });
          }
        } catch (e) {
          this.#logger.warn?.('logImage.imageProcessor.failed', { conversationId, error: e.message });
        }
      } else if (typeof photoSource === 'string') {
        imageForAI = photoSource;
      }

      this.#logger.info?.('logImage.aiCall', {
        conversationId,
        imageType: Buffer.isBuffer(imageForAI) ? 'buffer' : (typeof imageForAI === 'string' && imageForAI.startsWith('data:') ? 'base64' : 'url'),
        imageUrl: typeof imageForAI === 'string' && !imageForAI.startsWith('data:') ? imageForAI.substring(0, 120) : undefined,
        hasImageProcessor: !!this.#imageProcessor,
      });

      // 5. Call AI for food detection
      // Pre-fetch portion boost for AI prompt (non-fatal if unavailable)
      let portionBoost = '';
      if (this.#reconciliationReader) {
        try {
          const reconData = await this.#reconciliationReader();
          if (reconData?.avg_tracking_accuracy && reconData.avg_tracking_accuracy < 0.95) {
            const multiplier = (1 / reconData.avg_tracking_accuracy).toFixed(2);
            const accuracy = Math.round(reconData.avg_tracking_accuracy * 100);
            portionBoost = `\n\nIMPORTANT CALIBRATION: Historical data shows portion estimates are typically ${accuracy}% of actual weight. Multiply all gram estimates by ${multiplier}x. For example, if you would estimate 150g, report ${Math.round(150 * parseFloat(multiplier))}g instead.`;
          }
        } catch (e) {
          // Non-fatal — use uncalibrated estimates
        }
      }

      const prompt = this.#buildDetectionPrompt(portionBoost);
      const response = await this.#aiGateway.chatWithImage(prompt, imageForAI, { maxTokens: 4096 });

      this.#logger.info?.('logImage.aiResponse', {
        conversationId,
        responseLength: response?.length || 0,
        responsePreview: response?.substring(0, 200),
      });

      // 6. Parse response into food items
      const foodItems = this.#parseFoodResponse(response);

      if (foodItems.length === 0) {
        this.#logger.warn?.('logImage.noFoodDetected', {
          conversationId,
          imageUrl: imageUrl?.substring(0, 120),
          aiResponseLength: response?.length || 0,
          aiResponsePreview: response?.substring(0, 300),
        });
        await messaging.updateMessage(photoMsgId, {
          caption: "❓ I couldn't identify any food in this image. Could you describe what you're eating?",
        });
        return { success: false, error: 'No food detected' };
      }

      // 6b. Persist the captured photo and stamp its ref onto the produced
      // entries. Never fatal — a persistence failure (disk error, undecodable
      // buffer, missing photoStore) must not prevent the food from logging;
      // see #persistPhoto.
      const effectiveUserId = conversationId.split(':')[0] === 'cli' ? 'cli-user' : userId;
      await this.#persistPhoto({ effectiveUserId, conversationId, photoSource, foodItems });

      // 7. Create NutriLog domain entity
      const timezone = this.#getTimezone();
      const now = new Date();
      const localDate = now.toLocaleDateString('en-CA', { timeZone: timezone });
      const localHour = parseInt(now.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }));

      let mealTime = 'morning';
      if (localHour >= 11 && localHour < 14) mealTime = 'afternoon';
      else if (localHour >= 14 && localHour < 20) mealTime = 'evening';
      else if (localHour >= 20 || localHour < 5) mealTime = 'night';

      const nutriLog = createNutriLog({
        userId: effectiveUserId,
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

      // 8. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }

      // 8b. Record food items in catalog for quick-add
      if (this.#catalogService) {
        for (const item of foodItems) {
          try {
            await this.#catalogService.recordUsage({
              name: item.label,
              calories: item.calories,
              protein: item.protein,
              carbs: item.carbs,
              fat: item.fat,
              source: 'nutritionix',
            }, userId);
          } catch (err) {
            this.#logger.warn?.('nutribot.catalog.record_failed', { name: item.label, error: err.message });
          }
        }
      }

      // 9. Update photo caption with food list + action buttons
      const caption = this.#formatFoodCaption(foodItems, nutriLog.date || localDate);
      const buttons = this.#buildActionButtons(nutriLog.id);

      await messaging.updateMessage(photoMsgId, {
        caption,
        choices: buttons,
        inline: true,
      });

      // 10. Update NutriLog with messageId
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
      this.#logger.error?.('logImage.error', {
        conversationId,
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        imageUrl: imageData?.url?.substring(0, 120),
      });

      let retryStateWritten = false;
      if (photoMsgId && this.#conversationStateStore) {
        try {
          await this.#conversationStateStore.set(conversationId, {
            activeFlow: 'image_retry',
            flowState: {
              imageData: {
                fileId: imageData?.fileId,
                url: imageData?.url,
              },
              retryMessageId: photoMsgId,
            },
          });
          retryStateWritten = true;
        } catch (e) {
          this.#logger.warn?.('logImage.retryState.failed', {
            conversationId,
            error: e.message,
          });
        }
      }

      // Update the status photo so the user isn't left hanging
      if (photoMsgId) {
        const updatePayload = retryStateWritten
          ? {
              caption: '❌ Sorry, I had trouble analyzing this image. Tap 🔄 Retry to try again, or describe the food instead.',
              choices: [[{ text: '🔄 Retry', callback_data: this.#encodeCallback('ir', {}) }]],
              inline: true,
            }
          : {
              caption: '❌ Sorry, I had trouble analyzing this image. Please try again or describe the food instead.',
            };

        try {
          await messaging.updateMessage(photoMsgId, updatePayload);
        } catch (e) {
          this.#logger.debug?.('logImage.updateError.failed', { error: e.message });
        }
      }

      throw error;
    }
  }

  /**
   * Build detection prompt
   * @private
   */
  #buildDetectionPrompt(portionBoost = '') {
    const conservativeNote = portionBoost
      ? 'Use the portion adjustment factor above to calibrate your gram estimates.'
      : 'Be conservative with estimates.';

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
8. If a food is a composite dish (e.g. a sandwich, a smoothie, a burger) that you broke down into ingredient items per instruction 2, give every one of those ingredient items the SAME "dish" string (the dish's name). Standalone foods that were not broken down OMIT "dish" entirely. If the photo shows two separate dishes or plates, use a DIFFERENT "dish" value for each plate's items.

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
      "cholesterol": 25,
      "dish": "Burger"
    }
  ]
}
("dish" is OPTIONAL — omit it for a standalone item; include it only on items that are part of a named composite or a specific plate.)

${conservativeNote}${portionBoost}`,
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
      const jsonMatch = response.match(/\{[\s\S]*\}?/);
      if (!jsonMatch) {
        this.#logger.warn?.('logImage.parse.noJson', {
          responseLength: response?.length || 0,
          responsePreview: response?.substring(0, 300),
        });
        return [];
      }
      let data;
      try {
        data = JSON.parse(jsonMatch[0]);
      } catch {
        data = repairTruncatedJson(jsonMatch[0]);
        if (data) {
          this.#logger.warn?.('logImage.parseRepaired', { itemCount: data.items?.length || 0 });
        }
      }
      if (!data) return [];
      const rawItems = data.items || [];
      this.#logger.info?.('logImage.parse.success', { itemCount: rawItems.length });

      const items = rawItems.map((item) => ({
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
        ...(item.dish ? { dish: item.dish } : {}),
      }));

      return groupParsedItems(items, { makeId: uuidv4 });
    } catch (e) {
      this.#logger.warn?.('logImage.parse.error', {
        error: e.message,
        responsePreview: response?.substring(0, 300),
      });
      return [];
    }
  }

  /**
   * Extract raw image bytes from whatever `photoSource` turned out to be
   * (see execute() step 2). Returns null when there is nothing persistable —
   * e.g. the download failed and the code fell back to a bare URL string.
   * @private
   */
  #extractImageBuffer(photoSource) {
    if (Buffer.isBuffer(photoSource)) return photoSource;
    if (typeof photoSource === 'string' && photoSource.startsWith('data:')) {
      const match = photoSource.match(/^data:[^;,]*;base64,(.*)$/s);
      if (match) {
        try {
          return Buffer.from(match[1], 'base64');
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * Persist the captured photo (best-effort) and stamp its `photoRef` onto
   * the entry that owns it: the GROUP row for a grouped (multi-item dish)
   * parse, or the standalone ITEM row for a single-item parse. Group members
   * (kind:'item' with a parentId) do NOT get their own photoRef — the group
   * they belong to already carries it.
   *
   * Never throws — a failure here (no photoStore configured, no persistable
   * buffer, a disk error, or jimp throwing inside PhotoStore) is logged as a
   * warning and the food is still logged without a photoRef.
   * @private
   */
  async #persistPhoto({ effectiveUserId, conversationId, photoSource, foodItems }) {
    if (!this.#photoStore) return;

    const buffer = this.#extractImageBuffer(photoSource);
    if (!buffer) {
      this.#logger.debug?.('logImage.photoStore.noBuffer', { conversationId });
      return;
    }

    let photoRef;
    try {
      photoRef = await this.#photoStore.save(effectiveUserId, buffer);
    } catch (e) {
      this.#logger.warn?.('logImage.photoStore.save.failed', {
        conversationId,
        userId: effectiveUserId,
        error: e.message,
      });
      return;
    }

    for (const entry of foodItems) {
      const isStandaloneItem = entry.kind === 'item' && !entry.parentId;
      if (entry.kind === 'group' || isStandaloneItem) {
        entry.photoRef = photoRef;
      }
    }

    this.#logger.info?.('logImage.photoStore.saved', { conversationId, userId: effectiveUserId, photoRef });
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
    const dateHeader = date ? formatDateHeader(date, { timezone: this.#getTimezone(), now: new Date() }) : '';
    const foodList = formatFoodList(items);
    const loggedSummary = formatLoggedSummary(items);
    return `${loggedSummary}\n${dateHeader}\n\n${foodList}`;
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
