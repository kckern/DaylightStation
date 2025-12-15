/**
 * Log Food From Text Use Case
 * @module nutribot/application/usecases/LogFoodFromText
 * 
 * Detects food from text description and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../_lib/logging/index.mjs';
import { FOOD_ICONS_STRING } from '../constants/foodIcons.mjs';

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
   */
  async execute(input) {
    const { userId, conversationId, text, messageId, date: overrideDate } = input;

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

      // 4. Parse response into food items and date
      const { items: foodItems, date: aiDate } = this.#parseFoodResponse(response);
      
      // Use override date if provided, otherwise use AI-detected date
      const logDate = overrideDate || aiDate;

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
        date: logDate,
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

      // 8. Update message with date header, food list, and buttons
      const dateHeader = this.#formatDateHeader(logDate);
      const foodList = this.#formatFoodList(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.uuid);

      await this.#messagingGateway.updateMessage(conversationId, statusMsgId, {
        text: `📝 ${dateHeader}\n\n${foodList}`,
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
        return {
          items: data.items || [],
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
   * Format date header for display
   * @private
   */
  #formatDateHeader(date) {
    const { today } = getCurrentTimeDetails();
    
    // Parse the date
    const logDate = new Date(date + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    
    // Calculate days difference
    const diffTime = todayDate.getTime() - logDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    // Format the date nicely
    const options = { weekday: 'long', month: 'short', day: 'numeric' };
    const formattedDate = logDate.toLocaleDateString('en-US', options);
    
    if (diffDays === 0) {
      return `Today (${formattedDate})`;
    } else if (diffDays === 1) {
      return `Yesterday (${formattedDate})`;
    } else if (diffDays > 1 && diffDays <= 7) {
      return `${formattedDate} (${diffDays} days ago)`;
    } else {
      return formattedDate;
    }
  }

  /**
   * Format food list for display with noom color circles
   * @private
   */
  #formatFoodList(items) {
    const colorEmoji = {
      green: '🟢',
      yellow: '🟡',
      orange: '🟠',
    };
    
    return items.map(item => {
      const qty = item.quantity || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      const color = colorEmoji[item.noom_color] || '⚪';
      return `${color} ${qty} ${unit} ${item.name} (${cals} cal)`;
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
