// backend/src/2_adapters/nutribot/NutribotInputRouter.mjs

import { BaseInputRouter } from '#apps/common/input/BaseInputRouter.mjs';
import { decodeCallback, CallbackActions } from '../lib/callback.mjs';
import { buildCommittedChoices, withCommittedChoices } from '../lib/committedChoices.mjs';
import { stampUnsettled } from '../lib/unsettledStamp.mjs';
import { NutribotScaleRefusal } from '../ports/NutribotScaleRefusal.mjs';
import { MealTimes } from '#domains/nutrition/entities/schemas.mjs';

/**
 * Nutribot Input Router
 *
 * Routes IInputEvents to Nutribot use cases.
 * Transforms platform-agnostic events to use case input shapes.
 */
export class NutribotInputRouter extends BaseInputRouter {
  #userResolver;
  #userIdentityService;
  #aiGatewayAvailable;
  #cleanupProvider;

  /**
   * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
   * @param {Object} [options]
   * @param {import('../identity/ConfigUserResolver.mjs').ConfigUserResolver} [options.userResolver] - For resolving platform users to system usernames
   * @param {import('../../2_domains/messaging/services/UserIdentityService.mjs').UserIdentityService} [options.userIdentityService] - Domain identity service (preferred)
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    super(container, options);
    this.#userIdentityService = options.userIdentityService || null;
    this.#userResolver = options.userResolver;
    this.#aiGatewayAvailable = options.aiGatewayAvailable !== false;
    this.#cleanupProvider = options.cleanupProvider;
  }

  async route(event, responseContext = null) {
    if (event.platform === 'telegram') {
      const handled = await this.#cleanupProvider?.()?.handleTelegram(this.#resolveUserId(event), event, responseContext);
      if (handled) return { ok: true, handled: true };
    }
    return super.route(event, responseContext);
  }

  // ==================== Auto-commit seam ====================

  reviewPending(input) { return this.container.getFoodLogReview().execute(input); }
  //
  // AI captures (text / voice / image / barcode) are logged IMMEDIATELY as
  // unsettled — there is no pending Accept/Revise/Discard gate any more. The
  // seam is two narrow pieces, both owned here:
  //
  //   * message seam — `withCommittedChoices` decorates the responseContext the
  //     use case sends through, so the keyboard it builds and sends from inside
  //     itself never reaches the user offering Accept.
  //   * accept seam — after execute() returns, every item is stamped
  //     `settled: false` and the log runs the same accept path AcceptFoodLog
  //     uses (status -> accepted, acceptedAt stamped, nutrilist synced), which
  //     is what makes the rows visible to the day view and counted by
  //     BudgetService.
  //
  // SCALE IS EXEMPT: the scale branches never call this — they keep their
  // multi-step composition flow until a later phase replaces it.
  //
  // BARCODE stamps but does not accept: the UPC flow has no Accept gate to
  // retire, it commits at the portion-selection step (SelectUPCPortion), which
  // would refuse a log this seam had already accepted. Stamping here means the
  // rows that step writes carry `settled: false` without touching that use case.

  /**
   * Run a capture use case through the auto-commit seam.
   * @private
   * @param {Object} event
   * @param {Object|null} responseContext
   * @param {Object} opts
   * @param {string} opts.source - capture kind, for logs
   * @param {boolean} opts.commit - run the accept path (false for multi-step flows)
   * @param {(responseContext: Object|null) => Promise<any>} run
   */
  async #capture(event, responseContext, { source, commit }, run) {
    const decorated = withCommittedChoices(responseContext, {
      onRewrite: (logId, method) => {
        this.logger.debug?.('nutribot.capture.choicesRewritten', { source, logId, method });
      },
    });

    const result = await run(decorated);
    const logId = result?.nutrilogUuid || null;

    if (!logId) {
      this.logger.debug?.('nutribot.capture.noLog', { source, conversationId: event.conversationId });
      return { ok: true, result, committed: false, logId: null, items: [], mealTime: null, moved: false };
    }

    const userId = this.#resolveUserId(event);
    const items = await this.#stampUnsettled(userId, logId, source);
    const { mealTime, moved } = await this.#resolveMealTime({
      userId,
      logId,
      source,
      bucket: event.payload?.bucket || null,
      parsedMealTime: result?.mealTime ?? null,
      parsedMealTimeExplicit: result?.mealTimeExplicit === true,
    });

    if (!commit) {
      this.logger.debug?.('nutribot.capture.stampedOnly', { source, logId, itemCount: items.length });
      return { ok: true, result, committed: false, logId, items, mealTime, moved };
    }

    const committed = await this.#commitCapture({
      userId,
      conversationId: event.conversationId,
      logId,
      responseContext: decorated,
      source,
    });

    return { ok: true, result, committed, logId, items, mealTime, moved };
  }

  /**
   * Meal-time precedence — the ONE place this decision is made.
   *
   * Precedence: explicit-in-utterance/caption > bucket param > clock (the
   * clock default is already baked into the log's meal.time by the use case
   * that created it, via `getMealTimeFromHour` — untouched here means "keep
   * the clock default", which is what preserves backward compatibility for
   * every caller that never sends a `bucket`: Telegram, the coach, the scale).
   *
   * `moved` reports the ONLY case worth surfacing to the UI: the user asked
   * for one bucket (by launching the capture from it) but named a DIFFERENT
   * meal out loud, and that named meal won. Overriding a clock default with a
   * bucket, or matching the requested bucket, is not a "move" — it's just the
   * capture landing where it was asked to.
   *
   * @private
   * @param {Object} opts
   * @param {string} opts.userId
   * @param {string} opts.logId
   * @param {string} opts.source - capture kind, for logs
   * @param {string|null} opts.bucket - validated bucket id from the request, or null
   * @param {string|null} opts.parsedMealTime - the meal time the AI parse reported
   * @param {boolean} opts.parsedMealTimeExplicit - true only when the AI parse says the
   *   user named/implied a meal explicitly
   * @returns {Promise<{ mealTime: string|null, moved: boolean }>}
   */
  async #resolveMealTime({ userId, logId, source, bucket, parsedMealTime, parsedMealTimeExplicit }) {
    let store = null;
    try {
      store = this.container.getFoodLogStore?.();
    } catch {
      store = null;
    }
    if (!store?.findByUuid || !store?.save) return { mealTime: null, moved: false };

    let log;
    try {
      log = await store.findByUuid(logId, userId);
    } catch (e) {
      this.logger.warn?.('nutribot.capture.mealTime.fetchFailed', { source, logId, error: e.message });
      return { mealTime: null, moved: false };
    }
    if (!log) return { mealTime: null, moved: false };

    const currentMealTime = log.meal?.time || null;
    const validBucket = MealTimes.includes(bucket) ? bucket : null;
    const explicit = parsedMealTimeExplicit === true && MealTimes.includes(parsedMealTime);

    const resolvedMealTime = explicit ? parsedMealTime : (validBucket || currentMealTime);
    const moved = explicit && !!validBucket && parsedMealTime !== validBucket;

    if (resolvedMealTime && resolvedMealTime !== currentMealTime) {
      try {
        const mealDate = log.meal?.date;
        await store.save(log.updateDate(mealDate, resolvedMealTime, new Date()));
      } catch (e) {
        this.logger.warn?.('nutribot.capture.mealTime.saveFailed', { source, logId, error: e.message });
        return { mealTime: currentMealTime, moved: false };
      }
    }

    if (moved) {
      this.logger.info?.('nutribot.capture.mealMoved', {
        source, logId, requestedBucket: validBucket, resolvedMealTime,
      });
    } else if (explicit && resolvedMealTime !== currentMealTime) {
      // No requested-bucket conflict to report as "moved" (no bucket was sent,
      // or the explicit meal happened to match it) — but the entry still
      // deviated from the clock default because a meal was named explicitly.
      // Distinct event name (not just a `moved` field) so a log query for
      // "did the explicit-meal signal ever fire" doesn't have to also filter
      // on a boolean that's false by construction here.
      this.logger.info?.('nutribot.capture.mealTimeExplicitApplied', {
        source, logId, requestedBucket: validBucket, resolvedMealTime, clockDefault: currentMealTime,
      });
    }

    return { mealTime: resolvedMealTime, moved };
  }

  /**
   * Stamp `settled: false` on every item of a freshly parsed log.
   * Written verbatim — never `?? false` — because an ABSENT `settled` key is
   * the migration signal for legacy rows.
   * @private
   * @returns {Promise<Object[]>} the stamped item records
   */
  async #stampUnsettled(userId, logId, source) {
    let store = null;
    try {
      store = this.container.getFoodLogStore?.();
    } catch {
      store = null;
    }
    // Delegated, not duplicated: the scale commit path (`ObservationService`) has to
    // produce an entry indistinguishable from a capture, so the stamp has exactly one
    // implementation and both callers reach it. Log events are unchanged.
    return await stampUnsettled({ foodLogStore: store, userId, logId, source, logger: this.logger });
  }

  /**
   * Run the accept path on a freshly captured log.
   * `messageId` is deliberately omitted: the capture message has already been
   * sent (with Undo/Edit), and AcceptFoodLog would otherwise strip its buttons.
   * @private
   * @returns {Promise<boolean>}
   */
  async #commitCapture({ userId, conversationId, logId, responseContext, source }) {
    try {
      const useCase = this.container.getAcceptFoodLog();
      // autoReport:false — with the pending gate retired `findPending` is always
      // empty, so the accept path's auto-report would fire a full daily report
      // (rendered image + coaching kick, after a 300ms pause) inline in EVERY
      // capture request. Manual Accept paths keep the report.
      const accepted = await useCase.execute({
        userId, conversationId, logUuid: logId, responseContext, autoReport: false,
      });
      if (accepted?.success === false) {
        this.logger.warn?.('nutribot.capture.commitRefused', { source, logId, error: accepted.error });
        return false;
      }
      this.logger.info?.('nutribot.capture.committed', {
        source,
        conversationId,
        logId,
        itemCount: accepted?.itemCount ?? null,
      });
      return true;
    } catch (e) {
      this.logger.error?.('nutribot.capture.commitFailed', { source, logId, error: e.message });
      return false;
    }
  }

  // ==================== Event Handlers ====================

  async handleText(event, responseContext) {
    const conversationStateStore = this.container.getConversationStateStore?.();

    if (!conversationStateStore) {
      this.logger.debug?.('nutribot.handleText.noStateStore');
    }

    if (conversationStateStore) {
      try {
        const state = await conversationStateStore.get(event.conversationId);
        const pendingLogUuid = state?.flowState?.pendingLogUuid;

        this.logger.debug?.('nutribot.handleText.stateCheck', {
          conversationId: event.conversationId,
          hasState: !!state,
          activeFlow: state?.activeFlow || null,
          hasPendingLogUuid: !!pendingLogUuid,
        });

        if (state?.activeFlow === 'revision' && pendingLogUuid) {
          this.logger.info?.('nutribot.handleText.revisionRouted', {
            conversationId: event.conversationId,
            pendingLogUuid,
            text: event.payload.text?.substring(0, 50),
          });
          const useCase = this.container.getProcessRevisionInput();
          // Decorated: a revision lands on an ALREADY-COMMITTED log, so its
          // terminal keyboard must not offer Accept either.
          const result = await useCase.execute({
            userId: this.#resolveUserId(event),
            conversationId: event.conversationId,
            logUuid: pendingLogUuid,
            text: event.payload.text,
            messageId: event.messageId,
            responseContext: withCommittedChoices(responseContext),
          });
          return { ok: true, result };
        }

        if (state?.activeFlow === 'scale_describe' && pendingLogUuid) {
          if (!this.#aiGatewayAvailable) {
            return this.#aiUnavailable(event, responseContext, 'Food analysis is temporarily unavailable. Please try again shortly.');
          }
          this.logger.info?.('nutribot.handleText.scaleDescribeRouted', {
            conversationId: event.conversationId,
            pendingLogUuid,
          });
          const useCase = this.container.getLogScaleFoodFromText();
          const result = await this.#executeScale(() => useCase.execute({
            userId: this.#resolveUserId(event),
            conversationId: event.conversationId,
            logUuid: pendingLogUuid,
            text: event.payload.text,
            messageId: event.messageId,
            responseContext,
          }));
          return { ok: true, result };
        }
      } catch (e) {
        this.logger.warn?.('nutribot.handleText.stateCheck.error', {
          conversationId: event.conversationId,
          error: e.message,
        });
      }
    }

    // Default: log new food
    if (!this.#aiGatewayAvailable) {
      return this.#aiUnavailable(event, responseContext, 'Food analysis is temporarily unavailable. Please try again shortly.');
    }
    const useCase = this.container.getLogFoodFromText();
    return await this.#capture(event, responseContext, { source: 'text', commit: true }, (rc) =>
      useCase.execute({
        userId: this.#resolveUserId(event),
        conversationId: event.conversationId,
        text: event.payload.text,
        messageId: event.messageId,
        // The day the person is LOOKING AT becomes the parse's "today", so a
        // relative phrase ("this morning") resolves against that day. A date
        // the utterance names still wins — same precedence as the meal.
        asOfDate: event.payload.date || null,
        responseContext: rc,
      }));
  }

  async handleImage(event, responseContext) {
    if (!this.#aiGatewayAvailable) {
      return this.#aiUnavailable(event, responseContext, 'Image nutrition analysis is temporarily unavailable. Please describe the food instead.');
    }
    const useCase = this.container.getLogFoodFromImage();
    return await this.#capture(event, responseContext, { source: 'image', commit: true }, (rc) =>
      useCase.execute({
        userId: this.#resolveUserId(event),
        conversationId: event.conversationId,
        imageData: {
          fileId: event.payload.fileId,
          // Web path: a data URL set by WebNutribotAdapter. LogFoodFromImage only
          // consults `url` when `fileId` is falsy, so Telegram's fileId-driven
          // resolution is unaffected.
          url: event.payload.imageUrl,
          caption: event.payload.text,
        },
        messageId: event.messageId,
        date: event.payload.date || null,
        responseContext: rc,
      }));
  }

  async handleVoice(event, responseContext) {
    if (!this.#aiGatewayAvailable) {
      return this.#aiUnavailable(event, responseContext, 'Voice nutrition analysis is temporarily unavailable. Please describe the food instead.');
    }
    const useCase = this.container.getLogFoodFromVoice();
    return await this.#capture(event, responseContext, { source: 'voice', commit: true }, (rc) =>
      useCase.execute({
        userId: this.#resolveUserId(event),
        conversationId: event.conversationId,
        voiceData: {
          fileId: event.payload.fileId,
          // Set only on the web path, where the bytes were written to the
          // user's store before this call. It is what lets a failed
          // transcription say "your recording is saved" truthfully.
          audioRef: event.payload.fileId?.audioRef || null,
        },
        messageId: event.messageId,
        asOfDate: event.payload.date || null,
        responseContext: rc,
      }));
  }

  async handleUpc(event, responseContext) {
    const useCase = this.container.getLogFoodFromUPC();
    // commit:false — the barcode flow commits at its portion-selection step,
    // which refuses an already-accepted log. Items are still stamped unsettled.
    return await this.#capture(event, responseContext, { source: 'barcode', commit: false }, (rc) =>
      useCase.execute({
        userId: this.#resolveUserId(event),
        conversationId: event.conversationId,
        upc: event.payload.text,
        messageId: event.messageId,
        date: event.payload.date || null,
        responseContext: rc,
      }));
  }

  #aiUnavailable(event, responseContext, message) {
    this.logger.warn?.('nutribot.ai.unavailable', {
      conversationId: event.conversationId,
      type: event.type,
    });
    return Promise.resolve(responseContext?.sendMessage?.(message))
      .then(() => ({ ok: false, code: 'AI_UNAVAILABLE', error: message }));
  }

  async handleCallback(event, responseContext) {
    const decoded = decodeCallback(event.payload.callbackData);

    // Support both new format (a key) and legacy format (cmd key with short codes)
    let action = decoded.a || decoded.cmd;

    // Map legacy short codes to action constants
    const legacyActionMap = {
      a: CallbackActions.ACCEPT_LOG,
      r: CallbackActions.REVISE_ITEM,
      x: CallbackActions.REJECT_LOG,
      ir: CallbackActions.RETRY_IMAGE,
    };
    if (legacyActionMap[action]) {
      action = legacyActionMap[action];
    }

    // Note: Callback acknowledgement is handled by createBotWebhookHandler

    switch (action) {
      case CallbackActions.ACCEPT_LOG: {
        const useCase = this.container.getAcceptFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          messageId: event.messageId,
          responseContext,
          // App confirmation completes independently; optional surface reports
          // are regenerated from the committed ledger by the sync worker.
          autoReport: event.platform !== 'web',
        });
      }
      case CallbackActions.REJECT_LOG: {
        const useCase = this.container.getDiscardFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          messageId: event.messageId,
          responseContext,
        });
      }
      case CallbackActions.REVISE_ITEM: {
        const useCase = this.container.getReviseFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.logId || decoded.id,
          entryId: decoded.entryId || decoded.itemId,
          messageId: event.messageId,
          responseContext,
        });
      }
      case 'p': {
        // Portion selection (from UPC flow)
        const useCase = this.container.getSelectUPCPortion();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          portionFactor: decoded.f,
          messageId: event.messageId,
          responseContext,
        });
      }
      case 'st': {
        // Scale tare — decoded.c absent = show the container picker; present = subtract it
        const useCase = this.container.getSelectScaleContainer();
        return await this.#executeScale(() => useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          containerId: decoded.c,
          messageId: event.messageId,
          responseContext,
        }));
      }
      case 'sd': {
        // Scale density — resolve calories from tapped level
        const useCase = this.container.getSelectScaleDensity();
        return await this.#executeScale(() => useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          level: decoded.l,
          messageId: event.messageId,
          responseContext,
        }));
      }
      case 'sh': {
        // Scale help — toggle the density legend in place (h:1 show, h:0 back)
        const useCase = this.container.getShowScaleDensityHelp();
        return await this.#executeScale(() => useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: decoded.id,
          showHelp: decoded.h === 1 || decoded.h === '1',
          messageId: event.messageId,
          responseContext,
        }));
      }
      case 'ra': {
        // Report Adjust - start adjustment flow
        const useCase = this.container.getStartAdjustmentFlow();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          responseContext,
        });
      }
      case CallbackActions.RETRY_IMAGE: {
        if (!this.#aiGatewayAvailable) {
          return this.#aiUnavailable(event, responseContext, 'Image nutrition analysis is temporarily unavailable. Please describe the food instead.');
        }
        const useCase = this.container.getRetryImageDetection();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
      case 'rx': {
        // Report Accept/Close - just remove the buttons
        if (responseContext?.updateMessage) {
          try {
            await responseContext.updateMessage(event.messageId, { choices: [] });
          } catch (e) {
            this.logger.warn?.('nutribot.callback.rx.updateFailed', { error: e.message });
          }
        }
        return { ok: true, handled: true };
      }

      // ==================== Adjustment Flow Callbacks ====================

      case 'i': {
        // Select item for adjustment
        const useCase = this.container.getSelectItemForAdjustment();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          entryId: decoded.id,
          responseContext,
        });
      }

      case 'dt': {
        // Select date for adjustment
        const useCase = this.container.getSelectDateForAdjustment();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          daysAgo: decoded.d,
          offset: decoded.o || 0,
          responseContext,
        });
      }

      case 'pg': {
        // Pagination (same as dt but with offset)
        const useCase = this.container.getSelectDateForAdjustment();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          daysAgo: decoded.d,
          offset: decoded.o || 0,
          responseContext,
        });
      }

      case 'bd': {
        // Back to date selection
        const useCase = this.container.getShowDateSelection();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          responseContext,
        });
      }

      case 'bi': {
        // Back to items - reload current date's items
        const useCase = this.container.getSelectDateForAdjustment();
        // Get current date from state or default to 0 (today)
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          daysAgo: decoded.d ?? 0,
          offset: 0,
          responseContext,
        });
      }

      case 'f': {
        // Apply portion adjustment (fraction)
        const useCase = this.container.getApplyPortionAdjustment();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          entryId: decoded.id,
          factor: decoded.f,
          responseContext,
        });
      }

      case 'd': {
        // Delete list item
        const useCase = this.container.getDeleteListItem();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          entryId: decoded.id,
          responseContext,
        });
      }

      case 'm': {
        // Move item to different date (start move flow - show date picker)
        const useCase = this.container.getMoveItemToDate();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          entryId: decoded.id,
          // No newDate - will show date picker
          responseContext,
        });
      }

      case 'md': {
        // Move to date (date selected - execute move)
        const useCase = this.container.getMoveItemToDate();
        const daysAgo = decoded.d || 0;
        const newDate = this.#getDateFromDaysAgo(daysAgo);
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          entryId: decoded.id,
          newDate,
          responseContext,
        });
      }

      case 'dn': {
        // Done - regenerate report chart to reflect any adjustments
        try {
          const useCase = this.container.getGenerateDailyReport();
          return await useCase.execute({
            userId: this.#resolveUserId(event),
            conversationId: event.conversationId,
            messageId: event.messageId,
            skipPendingCheck: true,
            responseContext,
          });
        } catch (e) {
          this.logger.warn?.('nutribot.callback.dn.regenFailed', { error: e.message });
          // Fallback: just remove buttons if regen fails
          if (responseContext?.updateMessage) {
            try {
              await responseContext.updateMessage(event.messageId, { choices: [] });
            } catch (updateErr) {
              this.logger.warn?.('nutribot.callback.dn.updateFailed', { error: updateErr.message });
            }
          }
          return { ok: true, handled: true };
        }
      }

      case 'cr': {
        // Cancel revision - clear state and restore original buttons
        const conversationStateStore = this.container.getConversationStateStore?.();
        if (conversationStateStore) {
          try {
            await conversationStateStore.clear(event.conversationId);
          } catch (e) {
            this.logger.debug?.('nutribot.callback.cr.clearState.failed', { error: e.message });
          }
        }

        if (responseContext?.updateMessage) {
          try {
            // The log is already committed — restore the committed keyboard,
            // not the retired Accept/Revise/Discard gate.
            const buttons = buildCommittedChoices(decoded.id);
            await responseContext.updateMessage(event.messageId, { choices: buttons, inline: true });
          } catch (e) {
            this.logger.warn?.('nutribot.callback.cr.updateFailed', { error: e.message });
          }
        }
        return { ok: true, handled: true };
      }

      default:
        this.logger.warn?.('nutribot.callback.unknown', { action, decoded });
        return { ok: true, handled: false };
    }
  }

  async handleCommand(event, responseContext) {
    const command = event.payload.command;

    switch (command) {
      case 'help': {
        const useCase = this.container.getHandleHelpCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
      case 'review': {
        const useCase = this.container.getHandleReviewCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          responseContext,
        });
      }
      case 'report': {
        const useCase = this.container.getGenerateDailyReport();
        return await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          messageId: event.messageId,
          autoAcceptPending: true,
          responseContext,
        });
      }
      case 'coach': {
        const orchestrator = this.container.getAgentOrchestrator?.();
        if (!orchestrator) {
          if (responseContext?.sendMessage) {
            await responseContext.sendMessage('Coaching not available.', {});
          }
          return { ok: true, handled: false };
        }
        const result = await orchestrator.runAssignment('health-coach', 'note-review', {
          userId: this.#resolveUserId(event),
          context: { forceSpeak: true, conversationId: event.conversationId },
        });
        return { ok: true, result };
      }
      case 'done': {
        const healthStore = this.container.getHealthStore?.();
        if (!healthStore) {
          if (responseContext?.sendMessage) {
            await responseContext.sendMessage('Health store not available.', {});
          }
          return { ok: true, handled: false };
        }
        const userId = this.#resolveUserId(event);
        const today = new Date().toISOString().split('T')[0];
        await healthStore.markDayClosed(userId, today);
        this.logger.info?.('nutribot.command.done', { userId, date: today });
        if (responseContext?.sendMessage) {
          await responseContext.sendMessage(`Day marked as done for ${today}. Coaching will treat today's totals as final.`, {});
        }
        return { ok: true, handled: true };
      }
      default:
        this.logger.warn?.('nutribot.command.unknown', { command });
        return { ok: true, handled: false };
    }
  }

  async #executeScale(execute) {
    try {
      return await execute();
    } catch (error) {
      if (!String(error?.code || '').startsWith('NUTRIBOT_SCALE_')) throw error;
      this.logger.warn?.('nutribot.scale.refused', { code: error.code, error: error.message });
      return new NutribotScaleRefusal({ code: error.code, message: error.message });
    }
  }

  // ==================== Helpers ====================

  /**
   * Resolve user ID from platform identity
   * Uses UserResolver to map platform+platformUserId to system username
   * Falls back to conversationId if resolution fails
   * @private
   * @param {import('../telegram/IInputEvent.mjs').IInputEvent} event
   * @returns {string}
   */
  #resolveUserId(event) {
    // Direct userId (web adapter provides the resolved username directly)
    if (event.userId && !event.userId.includes(':')) {
      return event.userId;
    }

    // Prefer domain identity service
    if (this.#userIdentityService && event.platform && event.platformUserId) {
      const username = this.#userIdentityService.resolveUsername(event.platform, event.platformUserId);
      if (username) {
        this.logger.debug?.('nutribot.resolveUserId.resolved', { username, platformUserId: event.platformUserId });
        return username;
      }
      this.logger.warn?.('nutribot.identity.notFound', {
        platform: event.platform,
        platformUserId: event.platformUserId,
      });
    }

    // Fallback to legacy UserResolver
    if (this.#userResolver && event.platform && event.platformUserId) {
      const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
      if (username) return username;
    }

    // Fallback to conversationId for backwards compatibility
    return event.conversationId;
  }

  /**
   * Get date string from days ago
   * @private
   */
  #getDateFromDaysAgo(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}

export default NutribotInputRouter;
