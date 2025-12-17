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
 * @param {string} timezone - IANA timezone string
 */
function getCurrentTimeDetails(timezone = 'America/Los_Angeles') {
  const now = new Date();
  
  const today = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
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

      // Check if we're in food_confirmation state - might be an implicit revision
      let existingLogMessageId = null;
      let pendingLogUuid = null;
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        if (state?.activeFlow === 'food_confirmation' && state?.flowState?.pendingLogUuid) {
          pendingLogUuid = state.flowState.pendingLogUuid;
          existingLogMessageId = state.flowState.originalMessageId;
        }
      }

      // 2. Send "Analyzing..." message (always NEW - we'll handle revision case later)
      let statusMsgId;
      if (existingMessageId) {
        // Reuse existing message (voice flow already showed transcription)
        statusMsgId = existingMessageId;
      } else {
        // Create new status message with input preview
        const truncatedText = text.length > 100 ? text.substring(0, 100) + '...' : text;
        const result = await this.#messagingGateway.sendMessage(
          conversationId,
          `🔍 Analyzing...\n💬 "${truncatedText}"`,
          {}
        );
        statusMsgId = result.messageId;
      }

      // 3. Call AI for food detection
      const prompt = this.#buildDetectionPrompt(text);
      this.#logger.debug('logText.aiPrompt', { conversationId, text });
      
      const response = await this.#aiGateway.chat(prompt, {
        maxTokens: 1000,
      });
      
      this.#logger.debug('logText.aiResponse', { conversationId, response: response?.substring?.(0, 500) });

      // 4. Parse response into food items and date
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response);
      
      this.#logger.debug('logText.parsed', { 
        conversationId, 
        itemCount: foodItems.length, 
        date: aiDate,
        items: foodItems.map(i => ({ label: i.label, grams: i.grams, color: i.color }))
      });
      
      // Use override date if provided, otherwise use AI-detected date
      const logDate = overrideDate || aiDate;

      if (foodItems.length === 0) {
        this.#logger.debug('logText.noFood', { conversationId, text, response: response?.substring?.(0, 200) });
        // FALLBACK: Check if this might be a revision attempt on most recent unaccepted log
        // Pass existingLogMessageId so fallback can update original message instead of new one
        const fallbackResult = await this.#tryRevisionFallback(
          userId, 
          conversationId, 
          text, 
          statusMsgId,
          existingLogMessageId
        );
        
        if (fallbackResult.handled) {
          // Delete the new analyzing message if we used the existing one for revision
          if (existingLogMessageId && statusMsgId !== existingLogMessageId) {
            try {
              await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
            } catch (e) {
              // Ignore delete errors
            }
          }
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

      // 7. Update conversation state (include message ID for potential revisions)
      if (this.#conversationStateStore) {
        const state = ConversationState.create(conversationId, {
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: nutriLog.id, originalMessageId: statusMsgId },
        });
        await this.#conversationStateStore.set(conversationId, state);
      }

      // 8. Update message with date header, food list, and buttons
      const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone() });
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
5. Select the best matching icon from this list: ${FOOD_ICONS_STRING}
6. Determine the date - today is ${dayOfWeek}, ${today} at ${timeAMPM} (TZ: ${timezone}, unix: ${unix}). 
   If user mentions "yesterday", "last night", "on wednesday", etc., calculate the actual date.
7. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")
8. Prefer grams (g) or ml as the unit; only use other units (cup, tbsp, oz, piece) if the user explicitly says so. If you know grams, set unit="g".
9. Round grams to sensible whole numbers (nearest 5g) to avoid false precision (e.g., an apple ~180g, not 182.3g).

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
    const { today } = getCurrentTimeDetails(this.#getTimezone());
    
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        const rawItems = data.items || [];
        
        // Transform AI response items into domain FoodItem format
        const items = rawItems.map(item => {
          const estimatedGrams = item.grams || this.#estimateGrams(item);
          const gramsRounded = estimatedGrams
            ? Math.max(1, Math.round(estimatedGrams / 5) * 5)
            : null;

          return {
            id: uuidv4(),
            label: item.name || item.label || 'Unknown',
            grams: gramsRounded,
            unit: gramsRounded ? 'g' : (item.unit || 'serving'),
            amount: item.quantity || item.amount || (gramsRounded || 1),
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
      this.#logger.warn('logText.parseError', { error: e.message });
      return { items: [], date: today, time: null };
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
    return formatDateHeader(date, { timezone: this.#getTimezone() });
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
   * @param {string} userId
   * @param {string} conversationId
   * @param {string} text
   * @param {string} statusMsgId - The new "Analyzing..." message ID
   * @param {string} [existingLogMessageId] - The original food log message ID (if any)
   * @returns {Promise<{handled: boolean, success?: boolean, error?: string}>}
   */
  async #tryRevisionFallback(userId, conversationId, text, statusMsgId, existingLogMessageId = null) {
    this.#logger.debug('logText.revisionFallback.start', { conversationId, text, existingLogMessageId });
    
    // Use the original message if available, otherwise use the new status message
    const messageToUpdate = existingLogMessageId || statusMsgId;
    
    // Check conversation state for pending log UUID
    let pendingLogUuid = null;
    if (this.#conversationStateStore) {
      const state = await this.#conversationStateStore.get(conversationId);
      pendingLogUuid = state?.flowState?.pendingLogUuid;
      this.#logger.debug('logText.revisionFallback.stateCheck', { 
        conversationId, 
        hasState: !!state,
        activeFlow: state?.activeFlow,
        pendingLogUuid
      });
    }
    
    if (!pendingLogUuid) {
      // No pending log in state
      this.#logger.debug('logText.revisionFallback.noState', { conversationId });
      return { handled: false };
    }
    
    // Get the log by UUID
    let targetLog = null;
    if (this.#nutrilogRepository) {
      targetLog = await this.#nutrilogRepository.findByUuid(pendingLogUuid);
    }
    
    this.#logger.debug('logText.revisionFallback.foundLog', { 
      conversationId, 
      pendingLogUuid,
      found: !!targetLog,
      status: targetLog?.status
    });
    
    if (!targetLog || targetLog.status !== 'pending') {
      // Log not found or already processed
      this.#logger.debug('logText.revisionFallback.invalidLog', { conversationId, pendingLogUuid });
      return { handled: false };
    }
    
    this.#logger.info('logText.revisionFallback', { 
      targetLogUuid: targetLog.id,
      userInput: text.substring(0, 50) 
    });
    
    // Build contextual text with original items
    const originalItems = (targetLog.items || []).map(item => {
      const qty = item.quantity || item.amount || 1;
      const unit = item.unit || '';
      const name = item.label || item.name || 'Unknown';
      return `- ${qty} ${unit} ${name} (${item.calories || 0} cal)`;
    }).join('\n');

    const contextualText = `Original items:
${originalItems}

User revision: "${text}"`;

    // Update the original message (or fallback to new status message)
    await this.#messagingGateway.updateMessage(conversationId, messageToUpdate, {
      text: '🔍 Processing as revision...',
    });

    // Call AI with contextual prompt
    const prompt = this.#buildDetectionPrompt(contextualText);
    const response = await this.#aiGateway.chat(prompt, {
      maxTokens: 1000,
    });

    // Parse revised items AND date (user might be revising the date)
    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response);
    
    // If no items detected, keep the original items but still check for date change
    const finalItems = revisedItems.length > 0 ? revisedItems : (targetLog.items || []);
    
    if (finalItems.length === 0) {
      // Even with context, no items at all
      this.#logger.debug('logText.revisionFallback.noItems', { conversationId });
      return { handled: false };
    }

    // Update the existing log with revised items
    let updatedLog = targetLog.updateItems(finalItems);
    
    // Also update date if it changed
    if (revisedDate && revisedDate !== (targetLog.meal?.date || targetLog.date)) {
      this.#logger.debug('logText.revisionFallback.dateChanged', { 
        oldDate: targetLog.meal?.date || targetLog.date,
        newDate: revisedDate 
      });
      updatedLog = updatedLog.updateDate(revisedDate, revisedTime);
    }
    
    if (this.#nutrilogRepository) {
      await this.#nutrilogRepository.save(updatedLog);
    }

    // Keep conversation state in food_confirmation (already there)
    // No need to update state since pendingLogUuid is the same

    // Get the updated date from the log
    const logDate = updatedLog.meal?.date || updatedLog.date;
    
    // Update message with revised items
    const dateHeader = this.#formatDateHeader(logDate);
    const foodList = this.#formatFoodList(finalItems);
    const buttons = this.#buildActionButtons(updatedLog.id);

    await this.#messagingGateway.updateMessage(conversationId, messageToUpdate, {
      text: `${dateHeader}\n\n${foodList}`,
      choices: buttons,
      inline: true,
    });

    this.#logger.info('logText.revisionFallback.success', { 
      logUuid: updatedLog.id,
      itemCount: finalItems.length,
      messageId: messageToUpdate,
      date: logDate,
    });

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
