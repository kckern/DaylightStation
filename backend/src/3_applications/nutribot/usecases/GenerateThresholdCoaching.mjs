/**
 * Generate Threshold Coaching Use Case
 * @module nutribot/usecases/GenerateThresholdCoaching
 *
 * Generates coaching messages when nutrition thresholds are crossed.
 */

/**
 * Generate threshold coaching use case
 */
export class GenerateThresholdCoaching {
  #messagingGateway;
  #aiGateway;
  #nutriListStore;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { userId, conversationId, threshold, dailyTotal, recentItems = [] } = input;

    this.#logger.debug?.('coaching.threshold.start', { userId, threshold, dailyTotal });

    try {
      // 1. Check if coaching already given for this threshold today
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        const coachingKey = `coaching_${threshold}_${this.#getTodayDate(userId)}`;

        if (state?.flowState?.[coachingKey]) {
          this.#logger.debug?.('coaching.threshold.skipped', { userId, reason: 'already_given' });
          return { success: true, skipped: true };
        }
      }

      // 2. Build coaching prompt
      const prompt = this.#buildCoachingPrompt(threshold, dailyTotal, recentItems);

      // 3. Get AI coaching message
      const coachingMessage = await this.#aiGateway.chat(prompt, {
        maxTokens: 200,
        temperature: 0.7,
      });

      // 4. Send message
      const formattedMessage = this.#formatCoachingMessage(coachingMessage, threshold);
      const { messageId } = await this.#messagingGateway.sendMessage(conversationId, formattedMessage, { parseMode: 'HTML' });

      // 5. Record that coaching was given
      if (this.#conversationStateStore) {
        const coachingKey = `coaching_${threshold}_${this.#getTodayDate(userId)}`;
        await this.#conversationStateStore.update(conversationId, {
          data: { [coachingKey]: true },
        });
      }

      this.#logger.info?.('coaching.threshold.sent', { userId, threshold, messageId });

      return {
        success: true,
        messageId,
        message: formattedMessage,
      };
    } catch (error) {
      this.#logger.error?.('coaching.threshold.error', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Build coaching prompt based on threshold
   * @private
   */
  #buildCoachingPrompt(threshold, dailyTotal, recentItems) {
    const recentItemsText = recentItems
      .slice(0, 5)
      .map((item) => `${item.label} (${item.grams}g, ${item.color})`)
      .join(', ');

    const systemPrompt = `You are a supportive nutrition coach. Be encouraging, not judgmental.
Keep responses under 100 words. Use a ${this.#getToneForThreshold(threshold)} tone.`;

    const userPrompt = `The user has reached ${threshold} of their daily nutrition goal.
Current total: ${dailyTotal}g
Recent foods: ${recentItemsText || 'none logged recently'}

Provide brief, supportive coaching. ${this.#getCoachingFocus(threshold)}`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Get tone based on threshold level
   * @private
   */
  #getToneForThreshold(threshold) {
    if (threshold === '50%') return 'encouraging and informative';
    if (threshold === '80%') return 'gently cautionary';
    if (threshold === '100%') return 'supportive but firm';
    return 'neutral and helpful';
  }

  /**
   * Get coaching focus based on threshold
   * @private
   */
  #getCoachingFocus(threshold) {
    if (threshold === '50%') return 'Acknowledge progress and suggest maintaining balance.';
    if (threshold === '80%') return 'Suggest mindful choices for remaining meals.';
    if (threshold === '100%') return 'Acknowledge the day is done, encourage reflection without guilt.';
    return '';
  }

  /**
   * Format the coaching message with emoji
   * @private
   */
  #formatCoachingMessage(message, threshold) {
    const emoji = threshold === '100%' ? '🎯' : threshold === '80%' ? '⚡' : '💪';
    return `${emoji} <b>Nutrition Coach</b>\n\n${message}`;
  }

  /**
   * Get today's date in user's timezone
   * @private
   */
  #getTodayDate(userId) {
    const timezone = this.#config.getUserTimezone?.(userId) || 'America/Los_Angeles';
    return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  }
}

export default GenerateThresholdCoaching;
