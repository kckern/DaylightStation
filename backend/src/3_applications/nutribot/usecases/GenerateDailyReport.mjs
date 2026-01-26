/**
 * Generate Daily Report Use Case
 * @module nutribot/usecases/GenerateDailyReport
 *
 * Generates a daily nutrition report for a user, including
 * visual report and optional coaching messages.
 */

import { NOOM_COLOR_EMOJI } from '../../../1_domains/nutrition/entities/formatters.mjs';

/**
 * Generate daily nutrition report use case
 */
export class GenerateDailyReport {
  #messagingGateway;
  #foodLogStore;
  #nutriListStore;
  #conversationStateStore;
  #generateThresholdCoaching;
  #config;
  #logger;
  #encodeCallback;
  #reportRenderer;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.foodLogStore) throw new Error('foodLogStore is required');
    if (!deps.nutriListStore) throw new Error('nutriListStore is required');
    if (!deps.config) throw new Error('config is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#foodLogStore = deps.foodLogStore;
    this.#nutriListStore = deps.nutriListStore;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#generateThresholdCoaching = deps.generateThresholdCoaching;
    this.#config = deps.config;
    this.#logger = deps.logger || console;
    this.#encodeCallback = deps.encodeCallback || ((cmd, data) => JSON.stringify({ cmd, ...data }));
    this.#reportRenderer = deps.reportRenderer; // Optional: for generating PNG reports
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      sendPhoto: (src, options) => this.#messagingGateway.sendPhoto(conversationId, src, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, forceRegenerate = false, messageId: triggerMessageId, responseContext } = input;
    const date = input.date || this.#getTodayDate(userId);
    const anchorDateForHistory = this.#getTodayDate(userId);

    this.#logger.debug?.('report.generate.start', { userId, date, forceRegenerate, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // 0. Delete any existing report message
      try {
        let lastReportMessageId = null;
        if (this.#conversationStateStore) {
          const state = await this.#conversationStateStore.get(conversationId);
          lastReportMessageId = state?.lastReportMessageId;
        }

        const messagesToDelete = new Set();
        if (lastReportMessageId) messagesToDelete.add(String(lastReportMessageId));
        if (triggerMessageId) messagesToDelete.add(String(triggerMessageId));

        for (const msgId of messagesToDelete) {
          try {
            await messaging.deleteMessage( msgId);
          } catch (e) {
            this.#logger.debug?.('report.deleteMessage.failed', { msgId, error: e.message });
          }
        }
      } catch (e) {
        this.#logger.error?.('report.deletePrevious.error', { error: e.message });
      }

      // 1. Check for pending logs
      const skipPendingCheck = input.skipPendingCheck === true;
      const autoAcceptPending = input.autoAcceptPending === true;

      if (!skipPendingCheck) {
        if (forceRegenerate) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        const pendingLogs = await this.#foodLogStore.findPending(userId);

        if (pendingLogs.length > 0) {
          if (autoAcceptPending) {
            this.#logger.info?.('report.autoAccept.start', { userId, count: pendingLogs.length });
            await this.#autoAcceptPendingLogs(pendingLogs, messaging);
          } else {
            this.#logger.info?.('report.generate.skipped', { userId, reason: 'pending_logs', count: pendingLogs.length });
            try {
              await messaging.sendMessage( `⏳ ${pendingLogs.length} item(s) still need confirmation before generating report.`, {});
            } catch (e) {
              this.#logger.debug?.('report.sendPendingNotice.failed', { error: e.message });
            }
            return { success: false, skippedReason: `${pendingLogs.length} pending log(s)` };
          }
        }
      }

      // 2. Get daily summary
      const summary = await this.#foodLogStore.getDailySummary(userId, date);

      if (summary.logCount === 0) {
        this.#logger.info?.('report.generate.skipped', { userId, date, reason: 'no_logs' });
        return { success: false, skippedReason: 'No food logged for this date' };
      }

      // 3. Send "Generating..." status message
      const { messageId: statusMsgId } = await messaging.sendMessage( '📊 Generating report...', {});

      // 4. Get items for the report
      const items = await this.#nutriListStore.findByDate(userId, date);

      // 5. Calculate totals
      const totals = items.reduce(
        (acc, item) => {
          acc.calories += item.calories || 0;
          acc.protein += item.protein || 0;
          acc.carbs += item.carbs || 0;
          acc.fat += item.fat || 0;
          return acc;
        },
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

      const goals = this.#config.getUserGoals?.(userId);
      if (!goals) {
        throw new Error(`getUserGoals returned null for user ${userId}`);
      }

      // 6. Build history for chart
      const history = await this.#buildHistory(userId, anchorDateForHistory);

      // 7. Generate PNG report if renderer available
      let pngPath = null;
      if (this.#reportRenderer?.renderDailyReportToFile) {
        try {
          pngPath = await this.#reportRenderer.renderDailyReportToFile({
            date,
            totals,
            goals,
            items,
            history,
          });
        } catch (e) {
          this.#logger.error?.('report.png.failed', { error: e.message });
        }
      }

      // 8. Delete status message
      try {
        await messaging.deleteMessage( statusMsgId);
      } catch (e) {
        this.#logger.debug?.('report.deleteStatus.failed', { error: e.message });
      }

      // 9. Build caption
      const calorieMin = goals.calories_min || Math.round(goals.calories * 0.8);
      const calorieMax = goals.calories_max || goals.calories;

      let budgetStatus;
      if (totals.calories < calorieMin) {
        budgetStatus = `${calorieMin - totals.calories} cal below minimum`;
      } else if (totals.calories > calorieMax) {
        budgetStatus = `${totals.calories - calorieMax} cal over budget`;
      } else {
        const remaining = calorieMax - totals.calories;
        budgetStatus = remaining > 0 ? `${remaining} cal remaining` : 'at goal ✓';
      }

      const caloriePercent = Math.round((totals.calories / calorieMax) * 100);
      const goalDisplay = calorieMin !== calorieMax ? `${calorieMin}-${calorieMax}` : `${calorieMax}`;
      const caption = `🔥 ${totals.calories} / ${goalDisplay} cal (${caloriePercent}%) • ${budgetStatus}`;

      // 10. Build action buttons
      const buttons = [
        [
          { text: '✏️ Adjust', callback_data: this.#encodeCallback('ra') },
          { text: '✅ Accept', callback_data: this.#encodeCallback('rx') },
        ],
      ];

      // 11. Send report
      let messageId;
      if (pngPath) {
        const result = await messaging.sendPhoto(pngPath, caption, {
          choices: buttons,
          inline: true,
        });
        messageId = result.messageId;
      } else {
        const reportMessage = this.#buildReportMessage(summary, date);
        const result = await messaging.sendMessage( reportMessage, { parseMode: 'HTML', choices: buttons, inline: true });
        messageId = result.messageId;
      }

      // 12. Save report message ID
      if (messageId && this.#conversationStateStore) {
        try {
          let state = await this.#conversationStateStore.get(conversationId);
          if (!state) {
            state = { conversationId };
          }
          state.lastReportMessageId = messageId;
          await this.#conversationStateStore.set(conversationId, state);
        } catch (e) {
          this.#logger.warn?.('report.saveState.error', { error: e.message });
        }
      }

      this.#logger.info?.('report.generate.success', { userId, date, messageId, itemCount: summary.itemCount });

      // 13. Check thresholds and trigger coaching
      const coachingTriggered = await this.#checkAndTriggerCoaching(userId, conversationId, summary);

      return { success: true, messageId, summary, coachingTriggered };
    } catch (error) {
      this.#logger.error?.('report.generate.error', { userId, date, error: error.message });
      throw error;
    }
  }

  /**
   * Build history data for weekly chart
   * @private
   */
  async #buildHistory(userId, anchorDate) {
    const history = [];
    const [year, month, day] = anchorDate.split('-').map(Number);

    for (let i = 6; i >= 1; i--) {
      const d = new Date(year, month - 1, day - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      try {
        const items = await this.#nutriListStore.findByDate(userId, dateStr);
        const calories = items.reduce((sum, item) => sum + (item.calories || 0), 0);
        const protein = items.reduce((sum, item) => sum + (item.protein || 0), 0);
        const carbs = items.reduce((sum, item) => sum + (item.carbs || 0), 0);
        const fat = items.reduce((sum, item) => sum + (item.fat || 0), 0);
        history.push({ date: dateStr, calories, protein, carbs, fat, itemCount: items.length });
      } catch (e) {
        history.push({ date: dateStr, calories: 0, protein: 0, carbs: 0, fat: 0, itemCount: 0 });
      }
    }
    return history;
  }

  /**
   * Get today's date in user's timezone
   * @private
   */
  #getTodayDate(userId) {
    let timezone = 'America/Los_Angeles';
    try {
      if (this.#config?.getUserTimezone) {
        timezone = this.#config.getUserTimezone(userId);
      } else if (this.#config?.getDefaultTimezone) {
        timezone = this.#config.getDefaultTimezone();
      }
    } catch (e) {
      this.#logger.debug?.('report.getTimezone.failed', { error: e.message });
    }
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
   * Check thresholds and trigger coaching
   * @private
   */
  async #checkAndTriggerCoaching(userId, conversationId, summary) {
    if (!this.#generateThresholdCoaching) {
      return false;
    }

    const thresholds = this.#config.getThresholds?.(userId) || { daily: 2000 };
    const estimatedCalories = this.#estimateCalories(summary);

    if (estimatedCalories > thresholds.daily * 0.8) {
      this.#logger.debug?.('report.threshold.approaching', { userId, estimated: estimatedCalories });

      try {
        const threshold = estimatedCalories >= thresholds.daily ? '100%' : '80%';
        await this.#generateThresholdCoaching.execute({
          userId,
          conversationId,
          threshold,
          dailyTotal: estimatedCalories,
          recentItems: summary.items?.slice(-5) || [],
        });
        return true;
      } catch (e) {
        this.#logger.error?.('report.coaching.error', { userId, error: e.message });
        return false;
      }
    }

    return false;
  }

  /**
   * Rough calorie estimation from grams/colors
   * @private
   */
  #estimateCalories(summary) {
    const { gramsByColor } = summary;
    return (gramsByColor.green || 0) * 0.5 + (gramsByColor.yellow || 0) * 1.5 + (gramsByColor.orange || 0) * 3;
  }

  /**
   * Auto-accept pending logs
   * @private
   * @param {Array} pendingLogs - Logs to accept
   * @param {Object} messaging - Messaging interface
   */
  async #autoAcceptPendingLogs(pendingLogs, messaging) {
    const now = new Date();
    for (const log of pendingLogs) {
      try {
        const acceptedLog = log.accept(now);
        await this.#foodLogStore.save(acceptedLog);

        if (this.#nutriListStore?.syncFromLog) {
          await this.#nutriListStore.syncFromLog(acceptedLog);
        }

        const msgId = log.metadata?.messageId;
        if (msgId && messaging?.updateMessage) {
          try {
            await messaging.updateMessage(msgId, { choices: [] });
          } catch (e) {
            this.#logger.debug?.('report.updateMessage.failed', { msgId, error: e.message });
          }
        }
      } catch (e) {
        this.#logger.error?.('autoAccept.logFailed', { logId: log.id, error: e.message });
      }
    }
  }
}

export default GenerateDailyReport;
