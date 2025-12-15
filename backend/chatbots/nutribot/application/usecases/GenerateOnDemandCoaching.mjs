/**
 * Generate On-Demand Coaching Use Case
 * @module nutribot/application/usecases/GenerateOnDemandCoaching
 * 
 * Generates coaching when user explicitly requests advice via /coach command.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * @typedef {Object} GenerateOnDemandCoachingInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
 */

/**
 * @typedef {Object} GenerateOnDemandCoachingResult
 * @property {boolean} success
 * @property {string} [messageId]
 * @property {string} [message]
 */

/**
 * Generate on-demand coaching use case
 */
export class GenerateOnDemandCoaching {
  #messagingGateway;
  #aiGateway;
  #nutriLogRepository;
  #config;
  #logger;

  /**
   * @param {Object} deps
   */
  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {GenerateOnDemandCoachingInput} input
   * @returns {Promise<GenerateOnDemandCoachingResult>}
   */
  async execute(input) {
    const { userId, conversationId } = input;
    const today = this.#getTodayDate(userId);

    this.#logger.debug('coaching.ondemand.start', { userId });

    try {
      // 1. Load today's summary
      const summary = await this.#nutriLogRepository.getDailySummary(userId, today);

      // 2. Load recent days for context (last 3 days)
      const recentDays = await this.#loadRecentDays(userId, 3);

      // 3. Build coaching prompt
      const prompt = this.#buildCoachingPrompt(summary, recentDays);

      // 4. Get AI coaching message
      const coachingMessage = await this.#aiGateway.chat(prompt, {
        maxTokens: 300,
        temperature: 0.7,
      });

      // 5. Format and send message
      const formattedMessage = `🧑‍⚕️ <b>Nutrition Coach</b>\n\n${coachingMessage}`;
      const { messageId } = await this.#messagingGateway.sendMessage(
        conversationId,
        formattedMessage,
        { parseMode: 'HTML' }
      );

      this.#logger.info('coaching.ondemand.sent', { userId, messageId });

      return {
        success: true,
        messageId,
        message: formattedMessage,
      };
    } catch (error) {
      this.#logger.error('coaching.ondemand.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Load summaries for recent days
   * @private
   */
  async #loadRecentDays(userId, days) {
    const summaries = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      // Use local date, not UTC
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      
      const summary = await this.#nutriLogRepository.getDailySummary(userId, dateStr);
      if (summary.logCount > 0) {
        summaries.push({ date: dateStr, ...summary });
      }
    }

    return summaries;
  }

  /**
   * Build coaching prompt
   * @private
   */
  #buildCoachingPrompt(todaySummary, recentDays) {
    const systemPrompt = `You are a supportive, knowledgeable nutrition coach using the Noom color system.
- Green foods: low calorie density, eat freely (vegetables, fruits, lean proteins)
- Yellow foods: moderate calorie density, eat in moderation (whole grains, lean meats, dairy)
- Orange foods: high calorie density, be mindful (oils, nuts, sweets, processed foods)

Be encouraging, practical, and personalized. Keep responses under 150 words.`;

    let context = 'Today\'s nutrition:\n';
    if (todaySummary.logCount === 0) {
      context += 'No food logged yet today.\n';
    } else {
      context += `- ${todaySummary.itemCount} items, ${todaySummary.totalGrams}g total\n`;
      context += `- Green: ${todaySummary.gramsByColor.green || 0}g\n`;
      context += `- Yellow: ${todaySummary.gramsByColor.yellow || 0}g\n`;
      context += `- Orange: ${todaySummary.gramsByColor.orange || 0}g\n`;
    }

    if (recentDays.length > 1) {
      context += '\nRecent days:\n';
      for (const day of recentDays.slice(1)) {
        context += `- ${day.date}: ${day.totalGrams}g (G:${day.gramsByColor.green || 0}/Y:${day.gramsByColor.yellow || 0}/O:${day.gramsByColor.orange || 0})\n`;
      }
    }

    const userPrompt = `${context}\n\nProvide personalized nutrition coaching based on this data. Include one specific, actionable tip.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
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

export default GenerateOnDemandCoaching;
