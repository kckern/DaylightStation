import { capturedFoodGrams, capturedNutrientProvenance } from '#shared/contracts/health/foodQuantity.mjs';
/**
 * Log Food From Text Use Case
 * @module nutribot/usecases/LogFoodFromText
 *
 * Detects food from text description and creates a pending log.
 */

import { v4 as uuidv4 } from 'uuid';
import { formatFoodList, formatDateHeader, formatLoggedSummary, formatDensityWarnings } from '#domains/nutrition/entities/formatters.mjs';
import { repairTruncatedJson } from '../lib/repairJson.mjs';
import { deriveLogDate } from '../lib/deriveLogDate.mjs';
import { createNutriLog, serializeNutriLog } from '../nutriLogRecords.mjs';
import { groupParsedItems } from '#domains/nutrition/services/groupParsedItems.mjs';
import { aiMicrosSource, pickMicros } from '#domains/nutrition/services/micros.mjs';
import { confineIcon, iconVocabulary } from '#domains/nutrition/services/icons.mjs';

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
 * Produce time-details for a pinned date string, emulating getCurrentTimeDetails()
 * but anchored to the given YYYY-MM-DD instead of the wall clock. Used for revision
 * prompts so the AI's "today" context matches the ORIGINAL log's creation day.
 */
function pinnedTimeDetails(dateStr, timezone = 'America/Los_Angeles') {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Noon UTC on the target date — avoids timezone edge cases that could shift the day.
  const pinned = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const today = dateStr;
  const dayOfWeek = pinned.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone });
  const timeAMPM = '12:00 PM';
  const hourOfDay = 12;
  const unix = Math.floor(pinned.getTime() / 1000);
  const time = 'midday';
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
  #iconVocabulary;
  #reconciliationReader;
  #catalogService;
  #pause;

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
    this.#iconVocabulary = iconVocabulary(this.#foodIconsString, deps.foodIconNames);
    this.#reconciliationReader = deps.reconciliationReader || null;
    this.#catalogService = deps.catalogService || null;
    this.#pause = deps.pause || (async () => {});
  }

  /**
   * Get timezone from config
   * @private
   */
  #getTimezone() {
    return this.#config?.getDefaultTimezone?.() || 'America/Los_Angeles';
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
    const {
      userId, conversationId, text, messageId, date: overrideDate,
      // The day the CLIENT is looking at. It becomes the prompt's "today" and
      // the parse's fallback date, so "this morning" resolves against the
      // viewed day rather than the server's. A date the utterance names still
      // wins (the model computes it FROM this anchor) — same precedence the
      // meal bucket already uses. Absent means the wall clock, unchanged.
      asOfDate: viewedDate = null,
      existingMessageId, responseContext,
    } = input;

    this.#logger.info?.('logText.start', { conversationId, text, textLength: text.length, hasResponseContext: !!responseContext });

    // Get messaging interface (prefers responseContext)
    const messaging = this.#getMessaging(responseContext, conversationId);

    // Check if conversation is in revision mode BEFORE processing
    let isRevisionMode = false;
    let pendingLogUuid = null;
    let originalMessageId = null;
    if (this.#conversationStateStore) {
      const state = await this.#conversationStateStore.get(conversationId);
      if (state?.activeFlow === 'revision') {
        isRevisionMode = true;
        pendingLogUuid = state.flowState?.pendingLogUuid;
        originalMessageId = state.flowState?.originalMessageId;
        this.#logger.debug?.('logText.revisionMode', { conversationId, pendingLogUuid, originalMessageId });
      }
    }

    try {
      // SHORT-CIRCUIT: If in revision mode, handle revision directly
      // Skip generic AI call and status message creation — update original message in-place
      if (isRevisionMode && pendingLogUuid) {
        this.#logger.info?.('logText.revisionShortCircuit', {
          conversationId, pendingLogUuid, originalMessageId, text,
        });

        const revisionResult = await this.#handleRevisionDirect({
          userId, conversationId, pendingLogUuid, originalMessageId,
          text, messageId, messaging,
        });

        if (revisionResult) return revisionResult;

        // Stale revision state — log not found or not pending.
        this.#logger.warn?.('logText.revisionShortCircuit.staleState', { conversationId, pendingLogUuid });
        await messaging.sendMessage('Your revision session has expired. Please log the food again and try revising.', {});
        if (messageId) await this.#deleteMessageWithRetry(messaging, messageId);
        return { success: false, error: 'Revision session expired' };
      }

      // 1. Create status indicator (or use existing message for revision flows)
      const truncatedText = text.length > 300 ? text.substring(0, 300) + '...' : text;
      let status = null;
      let statusMsgId;

      if (existingMessageId) {
        // Revision flow: message already exists, just track its ID
        statusMsgId = existingMessageId;
      } else if (messaging.createStatusIndicator) {
        // Use status indicator with animation
        status = await messaging.createStatusIndicator(
          `🔍 Analyzing\n💬 "${truncatedText}"`,
          { frames: ['.', '..', '...'], interval: 2000 }
        );
        statusMsgId = status.messageId;
      } else {
        // Fallback for gateways without status indicator support
        const result = await messaging.sendMessage(`🔍 Analyzing...\n💬 "${truncatedText}"`, {});
        statusMsgId = result.messageId;
      }

      // 2. Call AI for food detection
      // Pre-fetch portion boost for AI prompt (non-fatal if unavailable)
      let portionBoost = '';
      if (this.#reconciliationReader) {
        try {
          const reconData = await this.#reconciliationReader();
          if (reconData?.avg_tracking_accuracy && reconData.avg_tracking_accuracy < 0.95) {
            const multiplier = (1 / reconData.avg_tracking_accuracy).toFixed(2);
            const accuracy = Math.round(reconData.avg_tracking_accuracy * 100);
            portionBoost = `\n\nIMPORTANT CALIBRATION: Historical data shows portion estimates are typically ${accuracy}% of actual weight. Multiply all gram estimates by ${multiplier}x. For example, if you would estimate 150g, report ${Math.round(150 * parseFloat(multiplier))}g instead.`;
          }
        } catch (e) {
          // Non-fatal — use uncalibrated estimates
        }
      }

      // Defensive: under current control flow the short-circuit at isRevisionMode + pendingLogUuid
      // returns before this point. Kept so that if #handleRevision (legacy fallback) is ever
      // invoked, the AI prompt is still pinned to the original log's date.
      // If this path reaches here in revision mode (short-circuit didn't fire),
      // pin the prompt to the existing log's date to prevent date drift.
      let asOfDateForRevision = null;
      if (isRevisionMode && pendingLogUuid && this.#foodLogStore) {
        try {
          const existing = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
          if (existing) {
            asOfDateForRevision = deriveLogDate(
              serializeNutriLog(existing),
              this.#getTimezone(),
            );
          }
        } catch (e) {
          this.#logger.debug?.('logText.asOfDate.deriveFailed', { error: e.message });
        }
      }

      // A revision is pinned to the ORIGINAL log's date and must stay pinned:
      // it outranks the viewed day, which outranks the wall clock.
      const asOfDate = asOfDateForRevision || viewedDate || null;
      const prompt = this.#buildDetectionPrompt(text, portionBoost, asOfDate);
      this.#logger.debug?.('logText.aiPrompt', { conversationId, text, asOfDate, asOfDateForRevision, viewedDate });

      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });
      this.#logger.debug?.('logText.aiResponse', { conversationId, response: response?.substring?.(0, 500) });

      // 3. Parse response into food items and date — same pin
      const { items: foodItems, date: aiDate, time: aiTime, mealTimeExplicit } = this.#parseFoodResponse(response, asOfDate);
      if (this.#catalogService?.resolveIdentity) {
        for (let index = 0; index < foodItems.length; index++) foodItems[index] = await this.#catalogService.resolveIdentity(foodItems[index], userId);
      }

      this.#logger.debug?.('logText.parsed', {
        conversationId,
        itemCount: foodItems.length,
        date: aiDate,
        items: foodItems.map((i) => ({ label: i.label, grams: i.grams, color: i.color })),
      });

      const logDate = overrideDate || aiDate;

      // Handle revision mode: update existing log instead of creating new one
      if (isRevisionMode && pendingLogUuid && foodItems.length > 0) {
        const revisionResult = await this.#handleRevision({
          userId,
          conversationId,
          pendingLogUuid,
          foodItems,
          logDate,
          aiTime,
          statusMsgId,
          originalMessageId,
          messageId,
          messaging,
        });
        // If revision succeeded, return; otherwise fall through to create new log
        if (revisionResult) {
          return revisionResult;
        }
        this.#logger.warn?.('logText.revision.fallbackToNew', { conversationId, pendingLogUuid });
      }

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

        if (status) {
          await status.finish("❓ I couldn't identify any food from your description. Could you be more specific?");
        } else {
          await messaging.updateMessage(statusMsgId, {
            text: "❓ I couldn't identify any food from your description. Could you be more specific?",
          });
        }
        return { success: false, error: 'No food detected' };
      }

      // 4. Create NutriLog entity
      const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
      const createTimestamp = new Date();
      const nutriLog = createNutriLog({
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

      // 5a-bis. Density guard (catalog-density fix, step 2). Runs BEFORE the
      // catalog donation below, because a donation adds this very row to the
      // history the guard compares against — judging a row against a median it
      // has already moved is not a check. It never corrects a number: the row
      // is logged exactly as parsed and lands UNSETTLED like every capture
      // (NutribotInputRouter stamps `settled: false`), so a flagged item simply
      // arrives on the pending-review surface with a reason attached.
      let densityWarning = '';
      if (this.#catalogService?.assessDensity) {
        try {
          const findings = await this.#catalogService.assessDensity(foodItems, userId);
          densityWarning = formatDensityWarnings(findings);
        } catch (err) {
          this.#logger.warn?.('nutribot.density.assess_failed', { conversationId, error: err.message });
        }
      }

      // 5b. Record food items in catalog for quick-add
      if (this.#catalogService) {
        for (const item of foodItems) {
          try {
            await this.#catalogService.recordUsage({
              foodId: item.foodId,
              name: item.label,
              calories: item.calories,
              protein: item.protein,
              carbs: item.carbs,
              fat: item.fat,
              // The MASS, and the id that makes this row's observation
              // idempotent. Without these the catalog can only remember a
              // total, which is the portion-multiple problem it just stopped
              // having.
              grams: item.grams,
              unit: item.unit,
              amount: item.amount,
              logId: item.id,
              // Spread, not four named fields: an unanswered micro is ABSENT
              // on `item` (see the mapper), and naming it here would
              // resurrect it as `undefined` -> a donated structural zero.
              ...pickMicros(item),
              // Only a provenanced row donates its micros at all —
              // see FoodCatalogService.recordUsage.
              microsSource: item.microsSource,
              source: 'nutritionix',
            }, userId);
          } catch (err) {
            this.#logger.warn?.('nutribot.catalog.record_failed', { name: item.label, error: err.message });
          }
        }
      }

      // 6. Update message with the logged summary, date header, food list, and buttons
      const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() });
      const foodList = formatFoodList(foodItems);
      const loggedSummary = formatLoggedSummary(foodItems);
      const buttons = this.#buildActionButtons(nutriLog.id);
      // '' when nothing was flagged, so the message is byte-identical to what
      // it has always been for the overwhelming majority of captures.
      const warningBlock = densityWarning ? `\n\n${densityWarning}` : '';

      try {
        if (status) {
          // Use status indicator's finish (stops animation, updates in place)
          await status.finish(`${loggedSummary}\n${dateHeader}\n\n${foodList}${warningBlock}`, {
            choices: buttons,
            inline: true,
          });
        } else {
          // Fallback: direct update
          await messaging.updateMessage(statusMsgId, {
            text: `${loggedSummary}\n${dateHeader}\n\n${foodList}${warningBlock}`,
            choices: buttons,
            inline: true,
          });
        }
      } catch (updateError) {
        this.#logger.warn?.('logText.updateMessage.failed', { conversationId, error: updateError.message });
        try {
          await messaging.sendMessage(`✅ Food logged! (message update failed)\n\n${dateHeader}\n\n${foodList}${warningBlock}`, { reply_markup: { inline_keyboard: buttons } });
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
        // Task 4.1 — meal-time precedence seam (NutribotInputRouter#capture).
        // The log itself always stores the CLOCK-derived meal.time above (unchanged,
        // for backward compatibility); mealTime/mealTimeExplicit here just report what
        // the AI parsed, so the router seam can override the stored log when the user
        // named a meal explicitly ("for lunch") or a bucket param was supplied.
        mealTime: aiTime,
        mealTimeExplicit: mealTimeExplicit === true,
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
          await this.#pause(delay);
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
  #buildDetectionPrompt(userText, portionBoost = '', asOfDate = null) {
    const timezone = this.#getTimezone();
    const live = getCurrentTimeDetails(timezone);
    // When pinning the prompt to a specific "as of" date (revision flow), synthesize
    // the dayOfWeek/timeAMPM context from that date instead of the live wall clock.
    const { today, dayOfWeek, timeAMPM, unix, time } = asOfDate
      ? pinnedTimeDetails(asOfDate, timezone)
      : live;

    return [
      {
        role: 'system',
        content: `You are a nutrition analyzer. Given a food description:
1. Identify each food item mentioned
2. Estimate portion sizes in grams or common measures
3. Estimate macros (calories, protein, carbs, fat) and micronutrients (fiber, sugar, sodium, cholesterol) for each item
4. Assign a noom_color: "green" (low cal density), "yellow" (moderate), or "orange" (high cal density)
5. Select an equivalent food icon from this list: ${this.#foodIconsString}. Use "default" if none depicts the actual food; similar colors or ingredients are not an equivalent.
6. Determine the date - today is ${dayOfWeek}, ${today} at ${timeAMPM} (TZ: ${timezone}, unix: ${unix}).
   If user mentions "yesterday", "last night", "on wednesday", etc., calculate the actual date.
7. Use Title Case for all food names (e.g., "Grilled Chicken Breast", "Mashed Potatoes")
7b. The "name" is the FOOD, and only the food. The PORTION lives in "grams"/"quantity"/"unit" and must never appear in the name — no counts, no container, no size, no parenthetical: write "Premier Protein Shake", never "Premier Protein Shake (Bottle)", "2 Premier Protein Shakes", "Premier Protein Shake (335ml)" or "Almonds (Handful)". The same food eaten in a different amount must come back with the SAME name, because that name is the key the food is remembered under.
8. Prefer grams (g) or ml as the unit; only use other units (cup, tbsp, oz, piece) if the user explicitly says so.
9. Round grams to sensible whole numbers (nearest 5g).
10. If the description is a composite dish whose parts are listed separately (e.g. a smoothie and its ingredients, or spaghetti with noodles/sauce/cheese listed out), give every part item the SAME "dish" string (the dish's name). Standalone foods that are not part of a listed composite OMIT "dish" entirely.
11. Determine whether the user explicitly ASSIGNS this food to a specific meal (e.g. "for lunch", "breakfast was...", "a midnight snack") — not merely mentions a time or a meal word in passing. Do NOT set the flag for an incidental time reference (e.g. "I had this after my morning run" — the run happened in the morning, but no meal is being assigned) or a meal word used as scenery rather than an assignment (e.g. "grabbed it on the way to dinner with friends" — the food itself isn't being called dinner). If the user does explicitly assign a meal, set "mealTimeExplicit" to true and set "time" to that meal: "morning", "afternoon", "evening", or "night". Otherwise, omit "mealTimeExplicit" (or set it to false) and use your best-guess "time" as before.

Respond in JSON format:
{
  "date": "YYYY-MM-DD",
  "time": "${time}",
  "mealTimeExplicit": false,
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
      "cholesterol": 25,
      "dish": "Smoothie"
    }
  ]
}
("dish" is OPTIONAL — omit it for a standalone item; include it only on items that are part of a named composite.)
("mealTimeExplicit" is OPTIONAL — set true only when a meal is explicitly named or clearly implied; omit or use false otherwise.)

Be conservative with estimates. Use USDA values when possible.
Begin response with '{' character - output only valid JSON, no markdown.${portionBoost}`,
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
  #parseFoodResponse(response, asOfDate = null) {
    const { today } = asOfDate
      ? { today: asOfDate }
      : getCurrentTimeDetails(this.#getTimezone());

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}?/);
      if (jsonMatch) {
        let data;
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch {
          data = repairTruncatedJson(jsonMatch[0]);
          if (data) {
            this.#logger.warn?.('logText.parseRepaired', { itemCount: data.items?.length || 0 });
          }
        }
        if (!data) return { items: [], date: today, time: null, mealTimeExplicit: false };
        const rawItems = data.items || [];

        const items = rawItems.map((item) => {
          const estimatedGrams = capturedFoodGrams(item);
          const gramsRounded = estimatedGrams ? Math.max(1, Math.round(estimatedGrams / 5) * 5) : null;

          return {
            id: uuidv4(),
            label: item.name || item.label || 'Unknown',
            grams: gramsRounded,
            originalQuantity: { grams: item.grams ?? null, amount: item.quantity ?? item.amount ?? null, unit: item.unit ?? null },
            unit: gramsRounded ? 'g' : item.unit || 'serving',
            amount: item.quantity || item.amount || gramsRounded || 1,
            color: this.#normalizeNoomColor(item.noom_color || item.color),
            icon: confineIcon(item.icon, this.#iconVocabulary, item.name || item.label),
            calories: item.calories ?? 0,
            protein: item.protein ?? 0,
            carbs: item.carbs ?? 0,
            fat: item.fat ?? 0,
            // ONLY the micros the model actually answered. Defaulting them to 0
            // here would erase which ones it answered before anything downstream
            // could tell — and the catalog donation below reads exactly this
            // object, so an unanswered micro must not arrive as a 0 that later
            // quick-adds inherit as a 'catalog' reading, permanently. The stored
            // row still gets its 0: FoodItem/validateFoodItem apply that default
            // at the persistence boundary, which is where it belongs.
            ...pickMicros(item),
            // Provenance for the micros above. The `?? 0` defaults make a
            // never-measured micro indistinguishable from a measured zero, so
            // this field — set only when the model ACTUALLY returned micro
            // numbers — is the only thing that can tell them apart downstream
            // (BudgetService.microCoverage, the Today bar row).
            microsSource: aiMicrosSource(item),
            nutrientProvenance: capturedNutrientProvenance(item, 'ai', capturedFoodGrams(item)),
            ...(item.dish ? { dish: item.dish } : {}),
          };
        });

        return {
          items: groupParsedItems(items, { makeId: uuidv4 }),
          date: data.date || today,
          time: data.time || null,
          mealTimeExplicit: data.mealTimeExplicit === true,
        };
      }
      return { items: [], date: today, time: null, mealTimeExplicit: false };
    } catch (e) {
      this.#logger.warn?.('logText.parseError', { error: e.message });
      return { items: [], date: today, time: null, mealTimeExplicit: false };
    }
  }

  /**
   * Estimate grams from item data
   * @private
   */

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
   * Handle revision mode: update existing log with new items
   * @private
   */
  async #handleRevision({ userId, conversationId, pendingLogUuid, foodItems, logDate, aiTime, statusMsgId, originalMessageId, messageId, messaging }) {
    this.#logger.info?.('logText.revision.start', { conversationId, pendingLogUuid, itemCount: foodItems.length });

    // Load the existing log
    let targetLog = null;
    if (this.#foodLogStore) {
      targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
    }

    if (!targetLog) {
      this.#logger.warn?.('logText.revision.logNotFound', { conversationId, pendingLogUuid });
      // Fall through to create new log by returning null
      return null;
    }

    // Update the log with new items
    const revisionTimestamp = new Date();
    let updatedLog = targetLog.updateItems(foodItems, revisionTimestamp);

    // Update date if different
    const existingDate = targetLog.meal?.date || targetLog.date;
    if (logDate && logDate !== existingDate) {
      updatedLog = updatedLog.updateDate(logDate, aiTime, revisionTimestamp);
    }

    // Save the updated log
    if (this.#foodLogStore) {
      await this.#foodLogStore.save(updatedLog);
    }

    // Clear revision state
    if (this.#conversationStateStore) {
      await this.#conversationStateStore.clear(conversationId);
      this.#logger.debug?.('logText.revision.stateCleared', { conversationId });
    }

    // Update the message with revised items
    const finalDate = updatedLog.meal?.date || updatedLog.date;
    const dateHeader = formatDateHeader(finalDate, { timezone: this.#getTimezone(), now: new Date() });
    const foodList = formatFoodList(foodItems);
    const buttons = this.#buildActionButtons(updatedLog.id);

    // Determine which message to update (prefer original log message)
    const messageToUpdate = originalMessageId || statusMsgId;

    // Check if this was an image-based log for proper update format
    const isImageLog = targetLog.metadata?.source === 'image';
    const updatePayload = isImageLog
      ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
      : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };

    await messaging.updateMessage(messageToUpdate, updatePayload);

    // Delete the "Analyzing..." status message if different from the target
    if (statusMsgId && statusMsgId !== messageToUpdate) {
      try {
        await messaging.deleteMessage(statusMsgId);
      } catch (e) {
        this.#logger.debug?.('logText.revision.deleteStatus.failed', { error: e.message });
      }
    }

    // Delete original user message
    if (messageId) {
      await this.#deleteMessageWithRetry(messaging, messageId);
    }

    this.#logger.info?.('logText.revision.complete', {
      conversationId,
      logUuid: updatedLog.id,
      itemCount: foodItems.length,
    });

    return {
      success: true,
      nutrilogUuid: updatedLog.id,
      messageId: messageToUpdate,
      itemCount: foodItems.length,
      revised: true,
    };
  }

  /**
   * Handle revision directly — short-circuit path that skips generic AI detection.
   * Updates the original message in-place instead of creating new messages.
   * @private
   * @returns {object|null} Result object if successful, null if log not found
   */
  async #handleRevisionDirect({ userId, conversationId, pendingLogUuid, originalMessageId, text, messageId, messaging }) {
    // 1. Load the existing log
    let targetLog = null;
    if (this.#foodLogStore) {
      targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
    }

    if (!targetLog || targetLog.status !== 'pending') {
      this.#logger.warn?.('logText.revisionDirect.logNotFound', { conversationId, pendingLogUuid });
      return null;
    }

    const isImageLog = targetLog.metadata?.source === 'image';

    // 2. Update original message to show "Processing revision..."
    if (originalMessageId) {
      const processingPayload = isImageLog
        ? { caption: '🔍 Processing revision...' }
        : { text: '🔍 Processing revision...' };
      try {
        await messaging.updateMessage(originalMessageId, processingPayload);
      } catch (e) {
        this.#logger.debug?.('logText.revisionDirect.processingUpdate.failed', { error: e.message });
      }
    }

    // 3. Build contextual prompt with original items
    const originalItems = (targetLog.items || [])
      .map((item) => {
        const qty = item.quantity || item.amount || 1;
        const unit = item.unit || '';
        const name = item.label || item.name || 'Unknown';
        return `- ${qty} ${unit} ${name} (${item.calories || 0} cal)`;
      })
      .join('\n');

    const contextualText = `Original items:\n${originalItems}\n\nUser revision: "${text}"`;

    // 4-10. AI call, parse, update log, and update message — wrapped so we can
    // restore on failure. User's message is NOT deleted until after this succeeds.
    let updatedLog;
    let finalItems;
    let messageToUpdate;
    try {
      // 4. Call AI with revision-aware prompt — PIN "today" to the ORIGINAL log's
      //    createdAt date. This guarantees that if the user says nothing about
      //    dates, the AI emits the same date the log already has, and if the user
      //    says "yesterday", the AI subtracts from the original date (not from
      //    the revision-day wall clock).
      const timezone = this.#getTimezone();
      const originalDate = deriveLogDate(
        serializeNutriLog(targetLog),
        timezone,
      );
      const prompt = this.#buildDetectionPrompt(contextualText, '', originalDate);
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

      // 5. Parse response — same pin so parse fallback also uses original date
      const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response, originalDate);
      finalItems = revisedItems.length > 0 ? revisedItems : targetLog.items || [];

      if (finalItems.length === 0) {
        // Truly empty — restore original message with buttons
        const existingDate = targetLog.meal?.date || targetLog.date;
        const dateHeader = formatDateHeader(existingDate, { timezone: this.#getTimezone(), now: new Date() });
        const foodList = formatFoodList(targetLog.items || []);
        const buttons = this.#buildActionButtons(targetLog.id);

        if (originalMessageId) {
          const restorePayload = isImageLog
            ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
            : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };
          await messaging.updateMessage(originalMessageId, restorePayload);
        }

        // Delete user's text message — safe to do now since we've restored the original
        if (messageId) {
          await this.#deleteMessageWithRetry(messaging, messageId);
        }

        return {
          success: true,
          nutrilogUuid: targetLog.id,
          messageId: originalMessageId,
          itemCount: (targetLog.items || []).length,
          revised: true,
          note: 'Revision produced no new items; original items preserved',
        };
      }

      // 6. Update log with revised items
      const revisionTimestamp = new Date();
      updatedLog = targetLog.updateItems(finalItems, revisionTimestamp);

      const existingDate = targetLog.meal?.date || targetLog.date;
      if (revisedDate && revisedDate !== existingDate) {
        updatedLog = updatedLog.updateDate(revisedDate, revisedTime, revisionTimestamp);
      }

      // 7. Save
      if (this.#foodLogStore) {
        await this.#foodLogStore.save(updatedLog);
      }

      // 8. Clear conversation state
      if (this.#conversationStateStore) {
        await this.#conversationStateStore.clear(conversationId);
        this.#logger.debug?.('logText.revisionDirect.stateCleared', { conversationId });
      }

      // 9. Update ORIGINAL message with revised items + buttons
      const finalDate = updatedLog.meal?.date || updatedLog.date || existingDate;
      const dateHeader = formatDateHeader(finalDate, { timezone: this.#getTimezone(), now: new Date() });
      const foodList = formatFoodList(finalItems);
      const buttons = this.#buildActionButtons(updatedLog.id);

      messageToUpdate = originalMessageId;
      const updatePayload = isImageLog
        ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
        : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };

      if (messageToUpdate) {
        await messaging.updateMessage(messageToUpdate, updatePayload);
      }
    } catch (aiError) {
      this.#logger.error?.('logText.revisionDirect.aiError', { conversationId, error: aiError.message });
      // Restore original message with buttons so user can try again
      if (originalMessageId) {
        const buttons = this.#buildActionButtons(targetLog.id);
        const logDate = targetLog.meal?.date || targetLog.date;
        const dateHeader = formatDateHeader(logDate, { timezone: this.#getTimezone(), now: new Date() });
        const foodList = formatFoodList(targetLog.items || []);
        const restorePayload = isImageLog
          ? { caption: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true }
          : { text: `${dateHeader}\n\n${foodList}`, choices: buttons, inline: true };
        try { await messaging.updateMessage(originalMessageId, restorePayload); } catch (e) { /* best effort */ }
      }
      // Don't clear state and don't delete user's message — user might want to try again
      throw aiError;
    }

    // 10. Delete user's text message — only after AI succeeded and original message is updated
    if (messageId) {
      await this.#deleteMessageWithRetry(messaging, messageId);
    }

    this.#logger.info?.('logText.revisionDirect.complete', {
      conversationId,
      logUuid: updatedLog.id,
      itemCount: finalItems.length,
    });

    return {
      success: true,
      nutrilogUuid: updatedLog.id,
      messageId: messageToUpdate,
      itemCount: finalItems.length,
      revised: true,
    };
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

    // Check conversation state for pending log UUID and originalMessageId
    let pendingLogUuid = null;
    let originalMessageId = null;
    if (this.#conversationStateStore) {
      const state = await this.#conversationStateStore.get(conversationId);
      pendingLogUuid = state?.flowState?.pendingLogUuid;
      originalMessageId = state?.flowState?.originalMessageId;
    }

    const messageToUpdate = originalMessageId || existingLogMessageId || statusMsgId;

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

    // Call AI with contextual prompt — pin "today" to original log's date (same
    // reasoning as #handleRevisionDirect)
    const timezone = this.#getTimezone();
    const originalDate = deriveLogDate(
      serializeNutriLog(targetLog),
      timezone,
    );
    const prompt = this.#buildDetectionPrompt(contextualText, '', originalDate);
    const response = await this.#aiGateway.chat(prompt, { maxTokens: 4096 });

    const { items: revisedItems, date: revisedDate, time: revisedTime } = this.#parseFoodResponse(response, originalDate);
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

    if (this.#conversationStateStore) {
      await this.#conversationStateStore.clear(conversationId);
      this.#logger.debug?.('logText.revisionFallback.stateCleared', { conversationId });
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

    // Delete the "Analyzing..." status message if it's different from the target
    if (statusMsgId && statusMsgId !== messageToUpdate) {
      try {
        await messaging.deleteMessage(statusMsgId);
      } catch (e) {
        this.#logger.debug?.('logText.revisionFallback.deleteStatus.failed', { error: e.message });
      }
    }

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
