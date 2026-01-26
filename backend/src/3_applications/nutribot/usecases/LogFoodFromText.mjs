/**
 * Log Food From Text Use Case
 * @module nutribot/usecases/LogFoodFromText
 *
 * Detects food from text description and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { NutriLog } from '../../../1_domains/nutrition/entities/NutriLog.mjs';
import { formatFoodList, formatDateHeader } from '../../../1_domains/nutrition/entities/formatters.mjs';

/**
 * Get current time details for date context in prompts
 * @param {string} timezone - IANA timezone string
 */
function getCurrentTimeDetails(timezone = 'America/Los_Angeles') {
  const now = new Date();

  const today = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const timeAMPM = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone });
  const hourOfDay = parseInt(now.toLocaleTimeString('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }), 10);
  const unix = Math.floor(now.getTime() / 1000);

  const time = hourOfDay < 12 ? 'morning' : hourOfDay < 17 ? 'midday' : hourOfDay < 21 ? 'evening' : 'night';

  return { today, timezone, dayOfWeek, timeAMPM, hourOfDay, unix, time };
}

/**
 * Log food from text use case
 */
export class LogFoodFromText {
  #messagingGateway;
  #aiGateway;
  #foodLogStore;
  #conversationStateStore;
  #config;
  #logger;
  #encodeCallback;
  #foodIconsString;

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
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || this.#config?.weather?.timezone || 'America/Los_Angeles';
  }

  /**
   * Get the messaging interface (prefers responseContext for DDD compliance)
   * @private
   * @param {Object} [responseContext] - Bound response context
   * @param {string} conversationId - Fallback conversation ID
   * @returns {Object} - Messaging interface with sendMessage, updateMessage, deleteMessage
   */
  #getMessaging(responseContext, conversationId) {
    // Prefer responseContext when available (DDD-compliant, no string parsing)
    if (responseContext) {
      return responseContext;
    }
    // Fallback to messagingGateway with conversationId (for direct API calls)
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, text, messageId, date: overrideDate, existingMessageId, responseContext } = input;

    this.#logger.info?.('logText.start', { conversationId, text, textLength: text.length, hasResponseContext: !!responseContext });

    // Get messaging interface (prefers responseContext)
    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 1. Send "Analyzing..." message
      let statusMsgId;
      if (existingMessageId) {
        statusMsgId = existingMessageId;
      } else {
        const truncatedText = text.length > 300 ? text.substring(0, 300) + '...' : text;
        const result = await messaging.sendMessage(`🔍 Analyzing...\n💬 "${truncatedText}"`, {});
        statusMsgId = result.messageId;
      }

      // 2. Call AI for food detection
      const prompt = this.#buildDetectionPrompt(text);
      this.#logger.debug?.('logText.aiPrompt', { conversationId, text });

      const response = await this.#aiGateway.chat(prompt, { maxTokens: 1000 });
      this.#logger.debug?.('logText.aiResponse', { conversationId, response: response?.substring?.(0, 500) });

      // 3. Parse response into food items and date
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response);

      this.#logger.debug?.('logText.parsed', {
        conversationId,
        itemCount: foodItems.length,
        date: aiDate,
        items: foodItems.map((i) => ({ label: i.label, grams: i.grams, color: i.color })),
      });

      const logDate = overrideDate || aiDate;

      if (foodItems.length === 0) {
        this.#logger.debug?.('logText.noFood', { conversationId, text });

        // Try revision fallback
        const fallbackResult = await this.#tryRevisionFallback(userId, conversationId, text, statusMsgId, existingMessageId, messaging);

        if (fallbackResult.handled) {
          if (existingMessageId && statusMsgId !== existingMessageId) {
            try {
              await messaging.deleteMessage(statusMsgId);
            } catch (e) {
              this.#logger.debug?.('logText.deleteStatus.failed', { error: e.message });
            }
          }
          return fallbackResult;
        }

        await messaging.updateMessage(statusMsgId, {
          text: "❓ I couldn't identify any food from your description. Could you be more specific?",
        });
        return { success: false, error: 'No food detected' };
      }

      // 4. Create NutriLog entity
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const createTimestamp = new Date();
      const nutriLog = NutriLog.create({
        userId,
        conversationId,
        text,
        items: foodItems,
        meal: {
          date: logDate,
          time: this.#getMealTimeFromHour(createTimestamp.getHours()),
        },
        metadata: {
          source: 'text',
          sourceText: text,
        },
        timezone,
        timestamp: createTimestamp,
      });

      // 5. Save NutriLog
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(nutriLog);
      }

      // 6. Update message with date header, food list, and buttons
      const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() });
      const foodList = formatFoodList(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.id);

      try {
        await messaging.updateMessage(statusMsgId, {
          text: `${dateHeader}\n\n${foodList}`,
          choices: buttons,
          inline: true,
        });
      } catch (updateError) {
        this.#logger.warn?.('logText.updateMessage.failed', { conversationId, error: updateError.message });
        try {
          await messaging.sendMessage(`✅ Food logged! (message update failed)\n\n${dateHeader}\n\n${foodList}`, { reply_markup: { inline_keyboard: buttons } });
        } catch (recoveryError) {
          this.#logger.error?.('logText.recovery.failed', { conversationId, error: recoveryError.message });
        }
      }

      // 7. Delete original user message
      if (messageId) {
        await this.#deleteMessageWithRetry(messaging, messageId);
      }

      // 8. Update NutriLog with messageId
      if (this.#foodLogStore) {
        const updatedLog = nutriLog.with({
          metadata: { ...nutriLog.metadata, messageId: String(statusMsgId) },
        }, new Date());
        await this.#foodLogStore.save(updatedLog);
      }

      this.#logger.info?.('logText.complete', {
        conversationId,
        itemCount: foodItems.length,
        logUuid: nutriLog.id,
      });

      return {
        success: true,
        nutrilogUuid: nutriLog.id,
        messageId: statusMsgId,
        itemCount: foodItems.length,
      };
    } catch (error) {
      this.#logger.error?.('logText.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Get meal time from hour
   * @private
   */
  #getMealTimeFromHour(hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Delete message with retry
   * @private
   * @param {Object} messaging - Messaging interface
   * @param {string} messageId - Message to delete
   * @param {number} [maxRetries=3] - Max retry attempts
   */
  async #deleteMessageWithRetry(messaging, messageId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await messaging.deleteMessage(messageId);
        return;
      } catch (error) {
        const isRetryable = error.code === 'EAI_AGAIN' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET';
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          return;
        }
      }
    }
  }

  /**
   * Build detection prompt
   * @private
   */
  #buildDetectionPrompt(userText) {
    const timezone = this.#getTimezone();
    const { today, dayOfWeek, timeAMPM, unix, time } = getCurrentTimeDetails(timezone);

    return [
      {
        role: 'system',
        content: `You are a nutrition analyzer. Given a food description:
1. Identify each food item mentioned
2. Estimate portion sizes in grams or common measures
3. Estimate macros (calories, protein, carbs, fat) and micronutrients (fiber, sugar, sodium, cholesterol) for each item
4. Assign a noom_color: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Select the best matching icon from this list: ${this.#foodIconsString}
6. Determine the date - today is ${dayOfWeek}, ${today} at ${timeAMPM} (TZ: ${timezone}, unix: ${unix}).
   If user mentions "yesterday", "last night", "on wednesday", etc., calculate the actual date.
7. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")
8. Prefer grams (g) or ml as the unit; only use other units (cup, tbsp, oz, piece) if the user explicitly says so.
9. Round grams to sensible whole numbers (nearest 5g).

Respond in JSON format:
{
  "date": "YYYY-MM-DD",
  "time": "${time}",
  "items": [
    {
      "name": "Food Name In Title Case",
      "icon": "chicken",
      "noom_color": "yellow",
      "quantity": 1,
      "unit": "g|ml",
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

Be conservative with estimates. Use USDA values when possible.
Begin response with '{' character - output only valid JSON, no markdown.`,
      },
      {
        role: 'user',
        content: `Parse this food description: "${userText}"`,
      },
    ];
  }

  /**
   * Parse AI response into food items and date
   * @private
   */
  #parseFoodResponse(response) {
    const { today } = getCurrentTimeDetails(this.#getTimezone());

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const rawItems = data.items || [];

        const items = rawItems.map((item) => {
          const estimatedGrams = item.grams || this.#estimateGrams(item);
          const gramsRounded = estimatedGrams ? Math.max(1, Math.round(estimatedGrams / 5) * 5) : null;

          return {
            id: uuidv4(),
            label: item.name || item.label || 'Unknown',
            grams: gramsRounded,
            unit: gramsRounded ? 'g' : item.unit || 'serving',
            amount: item.quantity || item.amount || gramsRounded || 1,
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
          };
        });

        return {
          items,
          date: data.date || today,
          time: data.time || null,
        };
      }
      return { items: [], date: today, time: null };
    } catch (e) {
      this.#logger.warn?.('logText.parseError', { error: e.message });
      return { items: [], date: today, time: null };
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

  /**
   * Try to interpret failed food detection as a revision attempt
   * @private
   * @param {string} userId
   * @param {string} conversationId
   * @param {string} text
   * @param {string} statusMsgId
   * @param {string} [existingLogMessageId]
   * @param {Object} messaging - Messaging interface
   */
  async #tryRevisionFallback(userId, conversationId, text, statusMsgId, existingLogMessageId = null, messaging) {
    this.#logger.debug?.('logText.revisionFallback.start', { conversationId, text });

    const messageToUpdate = existingLogMessageId || statusMsgId;

    // Check conversation state for pending log UUID
    let pendingLogUuid = null;
    if (this.#conversationStateStore) {
      const state = await this.#conversationStateStore.get(conversationId);
      pendingLogUuid = state?.flowState?.pendingLogUuid;
    }

    if (!pendingLogUuid) {
      return { handled: false };
    }

    // Get the log by UUID
    let targetLog = null;
    if (this.#foodLogStore) {
      targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
    }

    if (!targetLog || targetLog.status !== 'pending') {
      return { handled: false };
    }

    this.#logger.info?.('logText.revisionFallback', { targetLogUuid: targetLog.id, userInput: text.substring(0, 50) });

    // Build contextual text with original items
    const originalItems = (targetLog.items || [])
      .map((item) => {
        const qty = item.quantity || item.amount || 1;
        const unit = item.unit || '';
        const name = item.label || item.name || 'Unknown';
        return `- ${qty} ${unit} ${name} (${item.calories || 0} cal)`;
      })
      .join('\n');

    const contextualText = `Original items:\n${originalItems}\n\nUser revision: "${text}"`;

    await messaging.updateMessage(messageToUpdate, {
      text: '🔍 Processing as revision...',
    });

    // Call AI with contextual prompt
    const prompt = this.#buildDetectionPrompt(contextualText);
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 1000 });

    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response);
    const finalItems = revisedItems.length > 0 ? revisedItems : targetLog.items || [];

    if (finalItems.length === 0) {
      return { handled: false };
    }

    // Update the existing log with revised items
    const revisionTimestamp = new Date();
    let updatedLog = targetLog.updateItems(finalItems, revisionTimestamp);

    if (revisedDate && revisedDate !== (targetLog.meal?.date || targetLog.date)) {
      updatedLog = updatedLog.updateDate(revisedDate, revisedTime, revisionTimestamp);
    }

    if (this.#foodLogStore) {
      await this.#foodLogStore.save(updatedLog);
    }

    const logDate = updatedLog.meal?.date || updatedLog.date;
    const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() });
    const foodList = formatFoodList(finalItems);
    const buttons = this.#buildActionButtons(updatedLog.id);

    await messaging.updateMessage(messageToUpdate, {
      text: `${dateHeader}\n\n${foodList}`,
      choices: buttons,
      inline: true,
    });

    this.#logger.info?.('logText.revisionFallback.success', { logUuid: updatedLog.id, itemCount: finalItems.length });

    return {
      handled: true,
      success: true,
      nutrilogUuid: updatedLog.id,
      messageId: messageToUpdate,
      itemCount: revisedItems.length,
    };
  }
}

export default LogFoodFromText;
