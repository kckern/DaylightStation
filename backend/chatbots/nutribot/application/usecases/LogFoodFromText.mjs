/**
 * Log Food From Text Use Case
 * @module nutribot/application/usecases/LogFoodFromText
 * 
 * Detects food from text description and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { FOOD_ICONS_STRING } from '../constants/foodIcons.mjs';
import { NutriLog } from '../../domain/NutriLog.mjs';
import { ConversationState } from '../../../domain/entities/ConversationState.mjs';
import { formatFoodList, formatDateHeader } from '../../domain/formatters.mjs';

/**
 * Get current time details for date context in prompts
 */
function getCurrentTimeDetails() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  const today = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const timeAMPM = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone });
  const hourOfDay = now.getHours();
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
   * @param {string} [input.date] - Override date (YYYY-MM-DD format), bypasses AI date detection
   * @param {string} [input.existingMessageId] - Existing message ID to reuse (for voice flow)
   */
  async execute(input) {
    const { userId, conversationId, text, messageId, date: overrideDate, existingMessageId } = input;

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

      // 2. Send or reuse "Analyzing..." message
      let statusMsgId;
      if (existingMessageId) {
        // Reuse existing message (voice flow already showed transcription)
        statusMsgId = existingMessageId;
      } else {
        // Create new status message
        const result = await this.#messagingGateway.sendMessage(
          conversationId,
          '🔍 Analyzing...',
          {}
        );
        statusMsgId = result.messageId;
      }

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt(text);
      const response = await this.#aiGateway.chat(prompt, {
        maxTokens: 1000,
      });

      // 4. Parse response into food items and date
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response);
      
      // Use override date if provided, otherwise use AI-detected date
      const logDate = overrideDate || aiDate;

      if (foodItems.length === 0) {
        // FALLBACK: Check if this might be a revision attempt on most recent unaccepted log
        const fallbackResult = await this.#tryRevisionFallback(
          userId, 
          conversationId, 
          text, 
          statusMsgId
        );
        
        if (fallbackResult.handled) {
          return fallbackResult; // Revision fallback succeeded
        }
        
        // No fallback possible - show error
        await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
          text: '❓ I couldn\'t identify any food from your description. Could you be more specific?',
        });
        return { success: false, error: 'No food detected' };
      }

      // 5. Create NutriLog entity using domain factory
      const nutriLog = NutriLog.create({
        userId,
        conversationId,
        text,
        items: foodItems,
        meal: {
          date: logDate,
          time: this.#getMealTimeFromHour(new Date().getHours()),
        },
        metadata: {
          source: 'text',
          sourceText: text,
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

      // 8. Update message with date header, food list, and buttons
      const dateHeader = formatDateHeader(logDate);
      const foodList = this.#formatFoodList(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.id);

      await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
        text: `${dateHeader}\n\n${foodList}`,
        choices: buttons,
        inline: true,
      });

      this.#logger.info('logText.complete', { 
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
      this.#logger.error('logText.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Get meal time from hour
   * @private
   */
  #getMealTimeFromHour(hour) {
    // MealTimes: morning, afternoon, evening, night
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Build detection prompt
   * @private
   */
  #buildDetectionPrompt(userText) {
    const { today, dayOfWeek, timeAMPM, timezone, unix, time } = getCurrentTimeDetails();
    
    return [
      {
        role: 'system',
        content: `You are a nutrition analyzer. Given a food description:
1. Identify each food item mentioned
2. Estimate portion sizes in grams or common measures
3. Estimate macros (calories, protein, carbs, fat) and micronutrients (fiber, sugar, sodium, cholesterol) for each item
4. Assign a noom_color: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Select the best matching icon from this list: ${FOOD_ICONS_STRING}
6. Determine the date - today is ${dayOfWeek}, ${today} at ${timeAMPM} (TZ: ${timezone}, unix: ${unix}). 
   If user mentions "yesterday", "last night", "on wednesday", etc., calculate the actual date.

Respond in JSON format:
{
  "date": "YYYY-MM-DD",
  "time": "${time}",
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
- green: lowest calorie density (vegetables, fruits, lean proteins, whole grains)
- yellow: moderate calorie density (grains, legumes, lean meats, dairy)
- orange: highest calorie density (nuts, oils, sweets, fried foods, processed foods)

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
    const { today } = getCurrentTimeDetails();
    
    try {
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
        
        return {
          items,
          date: data.date || today,
        };
      }
      return { items: [], date: today };
    } catch (e) {
      this.#logger.warn('logText.parseError', { error: e.message });
      return { items: [], date: today };
    }
  }

  /**
   * Estimate grams from item data
   * @private
   */
  #estimateGrams(item) {
    // If grams provided, use it
    if (item.grams) return item.grams;
    
    // Rough estimation from calories (avg ~1.5 cal/gram for mixed foods)
    if (item.calories) return Math.round(item.calories / 1.5);
    
    // Default based on unit
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
    const normalized = String(color || 'yellow').toLowerCase();
    if (['green', 'yellow', 'orange', 'red'].includes(normalized)) {
      return normalized === 'red' ? 'orange' : normalized;
    }
    return 'yellow';
  }

  /**
   * Format date header for display
   * @private
   */
  #formatDateHeader(date) {
    return formatDateHeader(date);
  }

  /**
   * Format food list for display with noom color circles
   * @private
   */
  #formatFoodList(items) {
    return formatFoodList(items);
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

  /**
   * Try to interpret failed food detection as a revision attempt
   * @private
   * @returns {Promise<{handled: boolean, success?: boolean, error?: string}>}
   */
  async #tryRevisionFallback(userId, conversationId, text, statusMsgId) {
    // Get all pending (unaccepted) logs for this conversation
    let pendingLogs = [];
    if (this.#nutrilogRepository?.findPendingByChat) {
      pendingLogs = await this.#nutrilogRepository.findPendingByChat(conversationId);
    }
    
    // Filter to only unaccepted logs (status: 'pending')
    const unacceptedLogs = pendingLogs.filter(log => log.status === 'pending');
    
    if (unacceptedLogs.length === 0) {
      // No unaccepted logs to revise
      return { handled: false };
    }
    
    // Get the most recent unaccepted log (last in array)
    const targetLog = unacceptedLogs[unacceptedLogs.length - 1];
    
    this.#logger.info('logText.revisionFallback', { 
      targetLogUuid: targetLog.uuid,
      userInput: text.substring(0, 50) 
    });
    
    // Build contextual text with original items
    const originalItems = targetLog.items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      return `- ${qty} ${unit} ${item.name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original items:
${originalItems}

User revision: "${text}"`;

    // Update status message
    await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
      text: '🔍 Processing as revision...',
    });

    // Call AI with contextual prompt
    const prompt = this.#buildDetectionPrompt(contextualText);
    const response = await this.#aiGateway.chat(prompt, {
      maxTokens: 1000,
    });

    // Parse revised items
    const { items: revisedItems } = this.#parseFoodResponse(response);
    
    if (revisedItems.length === 0) {
      // Even with context, couldn't detect food
      return { handled: false };
    }

    // Discard the old log
    if (this.#nutrilogRepository?.updateStatus) {
      await this.#nutrilogRepository.updateStatus(targetLog.uuid, 'discarded');
    }

    // Create new log with revised items (preserve original date)
    const newLog = {
      uuid: uuidv4(),
      chatId: conversationId,
      items: revisedItems,
      date: targetLog.date, // Preserve original date
      source: 'text',
      sourceText: `Revision: ${text}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // Save new log
    if (this.#nutrilogRepository) {
      await this.#nutrilogRepository.save(newLog);
    }

    // Update conversation state
    if (this.#conversationStateStore) {
      const state = ConversationState.create(conversationId, {
        activeFlow: 'food_confirmation',
        flowState: { pendingLogUuid: newLog.uuid },
      });
      await this.#conversationStateStore.set(conversationId, state);
    }

    // Update message with revised items
    const dateHeader = this.#formatDateHeader(newLog.date);
    const foodList = this.#formatFoodList(revisedItems);
    const buttons = this.#buildActionButtons(newLog.uuid);

    await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
      text: `${dateHeader}\n\n${foodList}`,
      choices: buttons,
      inline: true,
    });

    this.#logger.info('logText.revisionFallback.success', { 
      originalUuid: targetLog.uuid,
      newUuid: newLog.uuid,
      itemCount: revisedItems.length 
    });

    return {
      handled: true,
      success: true,
      nutrilogUuid: newLog.uuid,
      messageId: statusMsgId,
      itemCount: revisedItems.length,
    };
  }
}

export default LogFoodFromText;
