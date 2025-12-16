/**
 * Generate Daily Report Use Case
 * @module nutribot/application/usecases/GenerateDailyReport
 * 
 * Generates a daily nutrition report for a user, including
 * visual report and optional coaching messages.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { NOOM_COLOR_EMOJI } from '../../domain/formatters.mjs';

/**
 * @typedef {Object} GenerateDailyReportInput
 * @property {string} userId - User ID
 * @property {string} conversationId - Conversation ID for messaging
 * @property {string} [date] - Date to report on (YYYY-MM-DD), defaults to today
 * @property {boolean} [forceRegenerate=false] - Force regenerate even if pending logs exist
 */

/**
 * @typedef {Object} GenerateDailyReportResult
 * @property {boolean} success
 * @property {string} [messageId] - ID of sent report message
 * @property {Object} [summary] - Report summary data
 * @property {string} [skippedReason] - Why report was skipped
 * @property {boolean} [coachingTriggered] - Whether coaching was sent
 */

/**
 * Generate daily nutrition report use case
 */
export class GenerateDailyReport {
  #messagingGateway;
  #nutriLogRepository;
  #nutriListRepository;
  #conversationStateStore;
  #config;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('../../../application/ports/IMessagingGateway.mjs').IMessagingGateway} deps.messagingGateway
   * @param {import('../../repositories/NutriLogRepository.mjs').NutriLogRepository} deps.nutriLogRepository
   * @param {import('../../repositories/NutriListRepository.mjs').NutriListRepository} deps.nutriListRepository
   * @param {import('../../../application/ports/IConversationStateStore.mjs').IConversationStateStore} deps.conversationStateStore
   * @param {import('../../config/NutriBotConfig.mjs').NutriBotConfig} deps.config
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.nutriLogRepository) throw new Error('nutriLogRepository is required');
    if (!deps.nutriListRepository) throw new Error('nutriListRepository is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#nutriLogRepository = deps.nutriLogRepository;
    this.#nutriListRepository = deps.nutriListRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'nutribot' });
  }

  /**
   * Execute the use case
   * @param {GenerateDailyReportInput} input
   * @returns {Promise<GenerateDailyReportResult>}
   */
  async execute(input) {
    const { userId, conversationId, forceRegenerate = false } = input;
    const date = input.date || this.#getTodayDate(userId);

    this.#logger.debug('report.generate.start', { userId, date, forceRegenerate });

    try {
      // 1. Check for pending logs (unless force regenerate)
      if (!forceRegenerate) {
        const pendingLogs = await this.#nutriLogRepository.findPending(userId);
        if (pendingLogs.length > 0) {
          this.#logger.debug('report.generate.skipped', { userId, reason: 'pending_logs', count: pendingLogs.length });
          return {
            success: false,
            skippedReason: `${pendingLogs.length} pending log(s) need confirmation first`,
          };
        }
      }

      // 2. Get daily summary
      const summary = await this.#nutriLogRepository.getDailySummary(userId, date);

      // 3. If no logs, skip
      if (summary.logCount === 0) {
        this.#logger.debug('report.generate.skipped', { userId, reason: 'no_logs' });
        return {
          success: false,
          skippedReason: 'No food logged for this date',
        };
      }

      // 4. Build report message
      const reportMessage = this.#buildReportMessage(summary, date);

      // 5. Send report
      const { messageId } = await this.#messagingGateway.sendMessage(
        conversationId,
        reportMessage,
        { parseMode: 'HTML' }
      );

      this.#logger.info('report.generate.success', { userId, date, messageId, itemCount: summary.itemCount });

      // 6. Check thresholds and trigger coaching if needed
      const coachingTriggered = await this.#checkAndTriggerCoaching(userId, conversationId, summary);

      return {
        success: true,
        messageId,
        summary,
        coachingTriggered,
      };
    } catch (error) {
      this.#logger.error('report.generate.error', { userId, date, error: error.message });
      throw error;
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

  /**
   * Build the report message
   * @private
   */
  #buildReportMessage(summary, date) {
    const { logCount, itemCount, totalGrams, colorCounts, gramsByColor } = summary;

    let message = `📊 <b>Nutrition Report for ${date}</b>\n\n`;
    
    message += `📝 <b>Summary:</b>\n`;
    message += `• ${logCount} meal(s) logged\n`;
    message += `• ${itemCount} food item(s)\n`;
    message += `• ${totalGrams}g total\n\n`;

    message += `🎨 <b>By Color:</b>\n`;
    for (const color of ['green', 'yellow', 'orange']) {
      const count = colorCounts[color] || 0;
      const grams = gramsByColor[color] || 0;
      if (count > 0) {
        message += `${NOOM_COLOR_EMOJI[color]} ${color}: ${count} items (${grams}g)\n`;
      }
    }

    // Calculate percentages
    if (totalGrams > 0) {
      message += `\n📈 <b>Distribution:</b>\n`;
      const greenPct = Math.round((gramsByColor.green / totalGrams) * 100);
      const yellowPct = Math.round((gramsByColor.yellow / totalGrams) * 100);
      const orangePct = Math.round((gramsByColor.orange / totalGrams) * 100);
      message += `🟢 ${greenPct}% | 🟡 ${yellowPct}% | 🟠 ${orangePct}%`;
    }

    return message;
  }

  /**
   * Check thresholds and trigger coaching if needed
   * @private
   */
  async #checkAndTriggerCoaching(userId, conversationId, summary) {
    // Get user's calorie threshold from config
    const thresholds = this.#config.getThresholds?.(userId) || { daily: 2000 };
    
    // Simple threshold check - can be expanded
    const estimatedCalories = this.#estimateCalories(summary);
    
    if (estimatedCalories > thresholds.daily * 0.8) {
      this.#logger.debug('report.threshold.approaching', { userId, estimated: estimatedCalories, threshold: thresholds.daily });
      // Coaching would be triggered here - delegated to GenerateThresholdCoaching
      return true;
    }

    return false;
  }

  /**
   * Rough calorie estimation from grams/colors
   * @private
   */
  #estimateCalories(summary) {
    // Rough estimates: green=0.5cal/g, yellow=1.5cal/g, orange=3cal/g
    const { gramsByColor } = summary;
    return (
      (gramsByColor.green || 0) * 0.5 +
      (gramsByColor.yellow || 0) * 1.5 +
      (gramsByColor.orange || 0) * 3
    );
  }
}

export default GenerateDailyReport;
