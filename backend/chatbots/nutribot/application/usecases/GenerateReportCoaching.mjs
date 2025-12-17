/**
 * Generate Report Coaching Use Case
 * @module nutribot/application/usecases/GenerateReportCoaching
 * 
 * Generates coaching when a nutrition report is accepted.
 * First coaching of the day is detailed/retrospective, subsequent are concise.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * @typedef {Object} GenerateReportCoachingInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
 * @property {string} [date] - Date (YYYY-MM-DD), defaults to today
 * @property {Object} [reportData] - Current report summary data
 */

/**
 * @typedef {Object} GenerateReportCoachingResult
 * @property {boolean} success
 * @property {string} [messageId]
 * @property {string} [message]
 * @property {boolean} [isFirstOfDay]
 */

// Fallback messages for when AI fails
const FALLBACK_MESSAGES = {
  underGoal: '📊 Nice logging! You\'re at {calories}/{goal} calories. Keep it up!',
  atGoal: '🎯 You\'ve hit your calorie target for today! Great job staying on track.',
  overGoal: '📊 You\'re at {calories} calories today ({over} over goal). Tomorrow\'s a new day!',
  noData: '✅ Report accepted! Keep tracking to stay on top of your goals.',
};

/**
 * Generate report coaching use case
 */
export class GenerateReportCoaching {
  #messagingGateway;
  #aiGateway;
  #nutriListRepository;
  #nutriCoachRepository;
  #config;
  #logger;

  /**
   * @param {Object} deps
   */
  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.nutriListRepository) throw new Error('nutriListRepository is required');
    if (!deps.nutriCoachRepository) throw new Error('nutriCoachRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutriListRepository = deps.nutriListRepository;
    this.#nutriCoachRepository = deps.nutriCoachRepository;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {GenerateReportCoachingInput} input
   * @returns {Promise<GenerateReportCoachingResult>}
   */
  async execute(input) {
    const { userId, conversationId, reportData } = input;
    const date = input.date || this.#getTodayDate(userId);

    this.#logger.debug('coaching.report.start', { userId, date });

    try {
      // 1. Check if this is first coaching of the day
      const isFirstOfDay = await this.#nutriCoachRepository.isFirstOfDay(userId, date);
      
      // 2. Load context data
      const goals = this.#config.getUserGoals(userId);
      const todayItems = await this.#nutriListRepository.findByDate(userId, date);
      const todaySummary = this.#calculateSummary(todayItems, goals);
      
      // 3. Load history for context
      const nutriDayHistory = await this.#loadNutriDayHistory(userId, 14);
      const previousCoaching = await this.#nutriCoachRepository.getRecent(userId, 10);
      
      // 4. Build appropriate prompt
      const prompt = isFirstOfDay
        ? this.#buildFirstOfDayPrompt(todaySummary, nutriDayHistory, previousCoaching, goals)
        : this.#buildSubsequentPrompt(todaySummary, todayItems, previousCoaching, goals);

      // 5. Get AI coaching message
      let coachingMessage;
      try {
        coachingMessage = await this.#aiGateway.chat(prompt, {
          maxTokens: isFirstOfDay ? 400 : 150,
          temperature: 0.7,
        });
      } catch (aiError) {
        this.#logger.warn('coaching.report.aiFailed', { userId, error: aiError.message });
        coachingMessage = this.#getFallbackMessage(todaySummary, goals);
      }

      // 6. Save coaching to history
      await this.#nutriCoachRepository.save({
        userId,
        date,
        message: coachingMessage,
        isFirstOfDay,
        context: {
          calories: todaySummary.calories,
          protein: todaySummary.protein,
          recentItems: todayItems.slice(-3).map(i => i.name || i.item || i.label),
        },
      });

      // 7. Send message
      const formattedMessage = `💡 ${coachingMessage}`;
      const { messageId } = await this.#messagingGateway.sendMessage(
        conversationId,
        formattedMessage,
        {}
      );

      this.#logger.info('coaching.report.sent', { userId, date, messageId, isFirstOfDay });

      return {
        success: true,
        messageId,
        message: coachingMessage,
        isFirstOfDay,
      };
    } catch (error) {
      this.#logger.error('coaching.report.error', { userId, date, error: error.message });
      
      // Send fallback on any error
      try {
        const fallbackMsg = '✅ Report accepted! Keep tracking to stay on top of your goals.';
        await this.#messagingGateway.sendMessage(conversationId, `💡 ${fallbackMsg}`, {});
        return { success: true, message: fallbackMsg, isFirstOfDay: false };
      } catch (e) {
        // Even fallback failed, just return
        return { success: false };
      }
    }
  }

  /**
   * Calculate summary from items
   * @private
   */
  #calculateSummary(items, goals) {
    const summary = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sodium: 0,
      itemCount: items.length,
      colorCounts: { green: 0, yellow: 0, orange: 0 },
    };

    for (const item of items) {
      summary.calories += Math.round(item.calories || 0);
      summary.protein += Math.round(item.protein || 0);
      summary.carbs += Math.round(item.carbs || 0);
      summary.fat += Math.round(item.fat || 0);
      summary.fiber += Math.round(item.fiber || 0);
      summary.sodium += Math.round(item.sodium || 0);
      
      const color = item.color || item.noom_color || 'yellow';
      summary.colorCounts[color] = (summary.colorCounts[color] || 0) + 1;
    }

    // Add goal comparisons
    summary.calorieGoal = goals.calories;
    summary.caloriesRemaining = goals.calories - summary.calories;
    summary.proteinGoal = goals.protein;
    summary.proteinRemaining = goals.protein - summary.protein;

    return summary;
  }

  /**
   * Load nutriday history for context
   * @private
   */
  async #loadNutriDayHistory(userId, days) {
    const history = [];
    const today = new Date();

    for (let i = 1; i <= days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      const items = await this.#nutriListRepository.findByDate(userId, dateStr);
      if (items.length > 0) {
        let calories = 0, protein = 0, carbs = 0, fat = 0;
        for (const item of items) {
          calories += Math.round(item.calories || 0);
          protein += Math.round(item.protein || 0);
          carbs += Math.round(item.carbs || 0);
          fat += Math.round(item.fat || 0);
        }
        history.push({ date: dateStr, calories, protein, carbs, fat, itemCount: items.length });
      }
    }

    return history;
  }

  /**
   * Build first-of-day detailed prompt
   * @private
   */
  #buildFirstOfDayPrompt(todaySummary, history, previousCoaching, goals) {
    const systemPrompt = `You are a supportive nutrition coach providing a morning briefing. 
Analyze the user's recent nutrition patterns and provide thoughtful, encouraging feedback (3-4 sentences).

Focus on:
1. Yesterday's performance vs goals
2. Patterns from the past 2 weeks
3. One specific goal or focus for today

Guidelines:
- Be encouraging but honest about areas to improve
- Reference specific trends when relevant
- Don't repeat advice from recent coaching sessions
- Use 1-2 emoji max
- Keep under 500 characters`;

    // Build history summary
    let historySummary = '';
    if (history.length > 0) {
      const avgCalories = Math.round(history.reduce((sum, d) => sum + d.calories, 0) / history.length);
      const daysUnderGoal = history.filter(d => d.calories <= goals.calories).length;
      const avgProtein = Math.round(history.reduce((sum, d) => sum + d.protein, 0) / history.length);
      
      historySummary = `\n\nLast ${history.length} days:
- Average calories: ${avgCalories} (goal: ${goals.calories})
- Days under goal: ${daysUnderGoal}/${history.length}
- Average protein: ${avgProtein}g (goal: ${goals.protein}g)`;

      if (history[0]) {
        historySummary += `\n- Yesterday: ${history[0].calories} cal, ${history[0].protein}g protein`;
      }
    }

    // Build previous coaching summary to avoid repetition
    let coachingHistory = '';
    if (previousCoaching.length > 0) {
      const recentAdvice = previousCoaching.slice(0, 3).map(c => c.message).join(' | ');
      coachingHistory = `\n\nRecent coaching (avoid repeating):\n${recentAdvice}`;
    }

    const userPrompt = `Today's progress (${todaySummary.itemCount} items logged):
- Calories: ${todaySummary.calories}/${goals.calories} (${todaySummary.caloriesRemaining > 0 ? todaySummary.caloriesRemaining + ' remaining' : Math.abs(todaySummary.caloriesRemaining) + ' over'})
- Protein: ${todaySummary.protein}g/${goals.protein}g
- Carbs: ${todaySummary.carbs}g/${goals.carbs}g
- Fat: ${todaySummary.fat}g/${goals.fat}g
- Color distribution: ${todaySummary.colorCounts.green} green, ${todaySummary.colorCounts.yellow} yellow, ${todaySummary.colorCounts.orange} orange${historySummary}${coachingHistory}

Provide personalized coaching based on this data.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Build subsequent concise prompt
   * @private
   */
  #buildSubsequentPrompt(todaySummary, todayItems, previousCoaching, goals) {
    const systemPrompt = `You are a supportive nutrition coach providing brief feedback on a recent meal update. 
Keep it short and encouraging (1-2 sentences max).

Focus on:
1. The most recent food items logged
2. How this affects today's progress

Guidelines:
- Comment specifically on what was just logged
- Be encouraging, note positives
- Only mention concerns if significant
- Use 1 emoji max
- Keep under 200 characters`;

    // Get most recent items (last 3)
    const recentItems = todayItems.slice(-3);
    const recentItemsList = recentItems.map(i => {
      const name = i.name || i.item || i.label || 'Unknown';
      const cal = i.calories || 0;
      return `${name} (${cal} cal)`;
    }).join(', ');

    // Avoid repeating last coaching
    let avoidRepeat = '';
    if (previousCoaching.length > 0 && previousCoaching[0].message) {
      avoidRepeat = `\n\nLast coaching (don't repeat): "${previousCoaching[0].message.substring(0, 100)}..."`;
    }

    const userPrompt = `Just logged: ${recentItemsList}

Today's totals now: ${todaySummary.calories}/${goals.calories} cal, ${todaySummary.protein}g protein${avoidRepeat}

Give brief, encouraging feedback on this update.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Get fallback message when AI fails
   * @private
   */
  #getFallbackMessage(summary, goals) {
    if (summary.itemCount === 0) {
      return FALLBACK_MESSAGES.noData;
    }

    const diff = summary.calories - goals.calories;
    
    if (Math.abs(diff) < 100) {
      return FALLBACK_MESSAGES.atGoal;
    } else if (diff < 0) {
      return FALLBACK_MESSAGES.underGoal
        .replace('{calories}', summary.calories)
        .replace('{goal}', goals.calories);
    } else {
      return FALLBACK_MESSAGES.overGoal
        .replace('{calories}', summary.calories)
        .replace('{over}', diff);
    }
  }

  /**
   * Get today's date in user's timezone
   * @private
   */
  #getTodayDate(userId) {
    const timezone = this.#config.getUserTimezone(userId);
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }
}

export default GenerateReportCoaching;
