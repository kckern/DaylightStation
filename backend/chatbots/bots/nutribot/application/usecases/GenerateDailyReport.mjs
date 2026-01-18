/**
 * Generate Daily Report Use Case
 * @module nutribot/application/usecases/GenerateDailyReport
 * 
 * Generates a daily nutrition report for a user, including
 * visual report and optional coaching messages.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { encodeCallback } from '../../../../_lib/callback.mjs';
import { NOOM_COLOR_EMOJI } from '../../domain/formatters.mjs';
import { ConversationState } from '../../../../domain/entities/ConversationState.mjs';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { loadFile, saveFile } from '../../../../../lib/io.mjs';
import { userLoadFile, userSaveFile } from '../../../../../lib/io.mjs';

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
    const { userId, conversationId, forceRegenerate = false, messageId: triggerMessageId } = input;
    const date = input.date || this.#getTodayDate(userId);
    const anchorDateForHistory = this.#getTodayDate(userId); // Always end chart at "today" even if report is backdated

    this.#logger.debug('report.generate.start', { userId, date, forceRegenerate, triggerMessageId });

    try {
      // 0. Delete any existing report message (only one report at a time)
      try {
        let lastReportMessageId = null;
        
        if (this.#conversationStateStore) {
          const state = await this.#conversationStateStore.get(conversationId);
          lastReportMessageId = state?.lastReportMessageId;
        }
        
        // Legacy file fallback removed
        
        this.#logger.debug('report.checkPrevious', { 
          userId,
          lastReportMessageId,
          triggerMessageId,
        });
        
        // Delete both the last known report AND the message that triggered this (e.g. "Done" button)
        // This ensures we don't leave stale menus behind
        const messagesToDelete = new Set();
        if (lastReportMessageId) messagesToDelete.add(String(lastReportMessageId));
        if (triggerMessageId) messagesToDelete.add(String(triggerMessageId));

        for (const msgId of messagesToDelete) {
          this.#logger.debug('report.deletePrevious', { messageId: msgId });
          try {
            await this.#messagingGateway.deleteMessage(conversationId, msgId);
          } catch (e) {
            // Ignore individual delete errors (message might be same or already deleted)
            this.#logger.debug('report.deletePrevious.failed', { messageId: msgId, error: e.message });
          }
        }
      } catch (e) {
        this.#logger.error('report.deletePrevious.criticalError', { error: e.message, stack: e.stack });
      }

      // 1. Check for pending logs (always check unless skipPendingCheck is explicitly true)
      // forceRegenerate only forces regeneration of existing report, not bypassing pending check
      const skipPendingCheck = input.skipPendingCheck === true;
      const autoAcceptPending = input.autoAcceptPending === true;
      
      if (!skipPendingCheck) {
        // Small delay to allow concurrent webhook events to settle (e.g., portion selection + accept)
        if (forceRegenerate) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        let pendingLogs;
        try {
          pendingLogs = await this.#nutriLogRepository.findPending(userId);
        } catch (error) {
          this.#logger.error('report.generate.pendingCheckFailed', { 
            userId, 
            error: error.message,
            stack: error.stack,
          });
          throw new Error(`Failed to check pending logs: ${error.message}`);
        }
        
        this.#logger.debug('report.generate.pendingCheck', { 
          userId, 
          pendingCount: pendingLogs.length,
          pendingIds: pendingLogs.slice(0, 5).map(l => l.id), // Log first 5 IDs
          forceRegenerate,
          autoAcceptPending,
        });
        
        if (pendingLogs.length > 0) {
          if (autoAcceptPending) {
            // Auto-accept all pending logs and update their UI
            this.#logger.info('report.autoAccept.start', { userId, count: pendingLogs.length });
            await this.#autoAcceptPendingLogs(pendingLogs, conversationId);
            this.#logger.info('report.autoAccept.done', { userId, count: pendingLogs.length });
          } else {
            this.#logger.info('report.generate.skipped', { userId, reason: 'pending_logs', count: pendingLogs.length });
            // Send user feedback that pending items exist
            try {
              await this.#messagingGateway.sendMessage(
                conversationId,
                `⏳ ${pendingLogs.length} item(s) still need confirmation before generating report.`,
                {}
              );
            } catch (e) {
              // Ignore messaging errors
            }
            return {
              success: false,
              skippedReason: `${pendingLogs.length} pending log(s) need confirmation first`,
            };
          }
        }
      }

      // 2. Get daily summary
      let summary;
      try {
        summary = await this.#nutriLogRepository.getDailySummary(userId, date);
        this.#logger.debug('report.generate.summaryLoaded', { 
          userId, 
          date,
          logCount: summary.logCount,
          itemCount: summary.itemCount,
          totalCalories: summary.totals?.calories,
        });
      } catch (error) {
        this.#logger.error('report.generate.summaryFailed', { 
          userId, 
          date,
          error: error.message,
          stack: error.stack,
        });
        throw new Error(`Failed to get daily summary: ${error.message}`);
      }

      // 3. If no logs, skip
      if (summary.logCount === 0) {
        this.#logger.info('report.generate.skipped', { userId, date, reason: 'no_logs' });
        return {
          success: false,
          skippedReason: 'No food logged for this date',
        };
      }

      // 4. Send "Generating..." status message
      const { messageId: statusMsgId } = await this.#messagingGateway.sendMessage(
        conversationId,
        '📊 Generating report...',
        {}
      );

      // 5. Get items for the report
      let items;
      try {
        items = await this.#nutriListRepository.findByDate(userId, date);
        this.#logger.debug('report.generate.itemsLoaded', { 
          userId, 
          date,
          itemCount: items.length,
        });
      } catch (error) {
        this.#logger.error('report.generate.itemsLoadFailed', { 
          userId, 
          date,
          error: error.message,
          stack: error.stack,
        });
        throw new Error(`Failed to load items for date: ${error.message}`);
      }
      
      // 6. Calculate totals
      const totals = items.reduce((acc, item) => {
        acc.calories += item.calories || 0;
        acc.protein += item.protein || 0;
        acc.carbs += item.carbs || 0;
        acc.fat += item.fat || 0;
        return acc;
      }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

      let goals;
      try {
        goals = this.#config.getUserGoals?.(userId);
        if (!goals) {
          throw new Error(`getUserGoals returned null/undefined for user ${userId}`);
        }
        this.#logger.debug('report.generate.goalsLoaded', { 
          userId,
          goals,
        });
      } catch (error) {
        this.#logger.error('report.generate.goalsLoadFailed', { 
          userId,
          error: error.message,
          stack: error.stack,
        });
        throw new Error(`Failed to load nutrition goals for user ${userId}: ${error.message}`);
      }

      // 7. Build history for chart (last 7 days)
      let history;
      try {
        history = await this.#buildHistory(userId, anchorDateForHistory);
      } catch (error) {
        this.#logger.error('report.generate.historyFailed', { 
          userId,
          anchorDate: anchorDateForHistory,
          error: error.message,
          stack: error.stack,
        });
        // Use empty history as fallback
        history = [];
      }
      this.#logger.debug('report.history', { 
        userId, 
        date, 
        anchorDate: anchorDateForHistory,
        historyLength: history.length,
        historySummary: history.map(h => ({ date: h.date, cal: h.totalCalories, items: h.itemCount })),
      });

      // 8. Generate PNG report
      let pngPath = null;
      try {
        const { CanvasReportRenderer } = await import('../../../../adapters/http/CanvasReportRenderer.mjs');
        const canvasRenderer = new CanvasReportRenderer();
        const pngBuffer = await canvasRenderer.renderDailyReport({
          date,
          totals,
          goals,
          items,
          history,
        });
        
        // Save to temp file
        const tmpDir = path.join(os.tmpdir(), 'nutribot-reports');
        await fs.mkdir(tmpDir, { recursive: true });
        const pngFileName = `report-${date}-${Date.now()}.png`;
        pngPath = path.join(tmpDir, pngFileName);
        await fs.writeFile(pngPath, pngBuffer);
        this.#logger.debug('report.png.generated', { path: pngPath, size: pngBuffer.length });
      } catch (e) {
        this.#logger.error('report.png.failed', { 
          error: e.message, 
          stack: e.stack,
          date,
          totalsProvided: !!totals,
          goalsProvided: !!goals,
          itemCount: items?.length,
          historyLength: history?.length,
        });
      }

      // 9. Delete status message
      try {
        await this.#messagingGateway.deleteMessage(conversationId, statusMsgId);
      } catch (e) {
        // Ignore delete errors
      }

      // 10. Build caption - calorie budget summary (supports min/max range)
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
      const goalDisplay = calorieMin !== calorieMax 
        ? `${calorieMin}-${calorieMax}`
        : `${calorieMax}`;
      const caption = `🔥 ${totals.calories} / ${goalDisplay} cal (${caloriePercent}%) • ${budgetStatus}`;

      // 11. Build action buttons
      const buttons = [
        [
          { text: '✏️ Adjust', callback_data: encodeCallback('ra') },
          { text: '✅ Accept', callback_data: encodeCallback('rx') },
        ],
      ];

      // 12. Send report
      let messageId;
      if (pngPath) {
        // Send as photo with caption and buttons
        const result = await this.#messagingGateway.sendPhoto(conversationId, pngPath, {
          caption,
          choices: buttons,
          inline: true,
        });
        messageId = result.messageId;
      } else {
        // Fallback to text message
        const reportMessage = this.#buildReportMessage(summary, date);
        const result = await this.#messagingGateway.sendMessage(
          conversationId,
          reportMessage,
          { parseMode: 'HTML', choices: buttons, inline: true }
        );
        messageId = result.messageId;
      }

      // 13. Save report message ID for later deletion
      if (messageId && this.#conversationStateStore) {
        try {
          let state = await this.#conversationStateStore.get(conversationId);
          if (!state) {
             state = ConversationState.empty(conversationId);
          }
          
          const updatedState = state.setLastReportMessage(messageId);
          await this.#conversationStateStore.set(conversationId, updatedState);
          
          this.#logger.debug('report.saveState', { userId, messageId: messageId.toString() });
        } catch (e) {
          this.#logger.warn('report.saveState.error', { error: e.message });
        }
      }

      this.#logger.info('report.generate.success', { 
        userId, 
        date, 
        messageId, 
        itemCount: summary.itemCount,
        totalCalories: totals.calories,
        caption: caption.substring(0, 200) + (caption.length > 200 ? '...' : '')
      });

      // 14. Check thresholds and trigger coaching if needed
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
   * Build history data for the weekly chart
   * @private
   */
  async #buildHistory(userId, anchorDate) {
    const history = [];
    // Parse anchor date components to avoid UTC conversion issues
    const [year, month, day] = anchorDate.split('-').map(Number);
    
    for (let i = 6; i >= 1; i--) {
      // Create date using local components, then subtract days
      const d = new Date(year, month - 1, day - i);
      // Format as YYYY-MM-DD using local date
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      try {
        const items = await this.#nutriListRepository.findByDate(userId, dateStr);
        const calories = items.reduce((sum, item) => sum + (item.calories || 0), 0);
        const protein = items.reduce((sum, item) => sum + (item.protein || 0), 0);
        const carbs = items.reduce((sum, item) => sum + (item.carbs || 0), 0);
        const fat = items.reduce((sum, item) => sum + (item.fat || 0), 0);
        history.push({
          date: dateStr,
          calories,
          protein,
          carbs,
          fat,
          itemCount: items.length,
        });
      } catch (e) {
        this.#logger.warn('report.buildHistory.dateLoadFailed', { 
          userId,
          date: dateStr,
          error: e.message,
        });
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
      this.#logger.warn('report.timezone.error', { error: e.message });
    }
    const date = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    this.#logger.debug('report.getTodayDate', { userId, timezone, date, utcNow: new Date().toISOString() });
    return date;
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

  /**
   * Auto-accept pending logs and update their UI (remove keyboards)
   * @private
   * @param {Array} pendingLogs - Array of pending NutriLog instances
   * @param {string} conversationId - Conversation ID for messaging
   */
  async #autoAcceptPendingLogs(pendingLogs, conversationId) {
    const { formatFoodList, formatDateHeader } = await import('../../domain/formatters.mjs');
    
    for (const log of pendingLogs) {
      try {
        // Accept the log
        const acceptedLog = log.accept();
        await this.#nutriLogRepository.save(acceptedLog);
        
        // Sync to nutrilist
        if (this.#nutriListRepository?.syncFromLog) {
          await this.#nutriListRepository.syncFromLog(acceptedLog);
        }
        
        // Update UI: remove inline keyboard from the pending message
        // This works for both text and photo messages
        const msgId = log.metadata?.messageId;
        if (msgId) {
          try {
            // Just remove the keyboard - works for both text and photo messages
            await this.#messagingGateway.updateMessage(conversationId, msgId, {
              choices: [], // Remove inline keyboard
            });
            this.#logger.debug('autoAccept.uiUpdated', { logId: log.id, messageId: msgId });
          } catch (e) {
            this.#logger.debug('autoAccept.uiUpdateFailed', { logId: log.id, messageId: msgId, error: e.message });
          }
        } else {
          this.#logger.debug('autoAccept.noMessageId', { logId: log.id });
        }
      } catch (e) {
        this.#logger.error('autoAccept.logFailed', { 
          logId: log.id, 
          error: e.message,
          stack: e.stack,
        });
      }
    }
  }
}

export default GenerateDailyReport;
