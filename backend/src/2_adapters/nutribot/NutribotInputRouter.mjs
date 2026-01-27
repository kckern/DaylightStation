// backend/src/2_adapters/nutribot/NutribotInputRouter.mjs

import { BaseInputRouter } from '../BaseInputRouter.mjs';
import { decodeCallback, CallbackActions } from '#apps/nutribot/lib/callback.mjs';

/**
 * Nutribot Input Router
 *
 * Routes IInputEvents to Nutribot use cases.
 * Transforms platform-agnostic events to use case input shapes.
 */
export class NutribotInputRouter extends BaseInputRouter {
  #userResolver;

  /**
   * @param {import('../../3_applications/nutribot/NutribotContainer.mjs').NutribotContainer} container
   * @param {Object} [options]
   * @param {import('../../0_system/users/UserResolver.mjs').UserResolver} [options.userResolver] - For resolving platform users to system usernames
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    super(container, options);
    this.#userResolver = options.userResolver;
  }

  // ==================== Event Handlers ====================

  async handleText(event, responseContext) {
    // Check if we're in revision mode
    const conversationStateStore = this.container.getConversationStateStore?.();
    if (conversationStateStore) {
      const state = await conversationStateStore.get(event.conversationId);
      // ReviseFoodLog stores logUuid as pendingLogUuid in flowState
      const pendingLogUuid = state?.flowState?.pendingLogUuid;
      if (state?.activeFlow === 'revision' && pendingLogUuid) {
        this.logger.debug?.('nutribot.handleText.revisionMode', {
          conversationId: event.conversationId,
          pendingLogUuid,
          text: event.payload.text,
        });
        // Route to ProcessRevisionInput
        const useCase = this.container.getProcessRevisionInput();
        const result = await useCase.execute({
          userId: this.#resolveUserId(event),
          conversationId: event.conversationId,
          logUuid: pendingLogUuid,
          text: event.payload.text,
          messageId: event.messageId,
          responseContext,
        });
        return { ok: true, result };
      }
    }

    // Default: log new food
    const useCase = this.container.getLogFoodFromText();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      text: event.payload.text,
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleImage(event, responseContext) {
    const useCase = this.container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      imageData: {
        fileId: event.payload.fileId,
        caption: event.payload.text,
      },
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleVoice(event, responseContext) {
    const useCase = this.container.getLogFoodFromVoice();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      voiceData: {
        fileId: event.payload.fileId,
      },
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
  }

  async handleUpc(event, responseContext) {
    const useCase = this.container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId: this.#resolveUserId(event),
      conversationId: event.conversationId,
      upc: event.payload.text,
      messageId: event.messageId,
      responseContext,
    });
    return { ok: true, result };
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
          itemId: decoded.itemId,
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
          itemId: decoded.id,
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
          itemId: decoded.id,
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
          itemId: decoded.id,
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
          itemId: decoded.id,
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
          itemId: decoded.id,
          newDate,
          responseContext,
        });
      }

      case 'dn': {
        // Done - close adjustment flow, remove buttons
        if (responseContext?.updateMessage) {
          try {
            await responseContext.updateMessage(event.messageId, { choices: [] });
          } catch (e) {
            this.logger.warn?.('nutribot.callback.dn.updateFailed', { error: e.message });
          }
        }
        return { ok: true, handled: true };
      }

      case 'cr': {
        // Cancel revision - exit revision mode, restore original buttons
        // For now, just remove buttons (the log is still pending)
        if (responseContext?.updateMessage) {
          try {
            // Restore the original Accept/Revise/Discard buttons
            const encodeCallback = (cmd, data) => JSON.stringify({ cmd, ...data });
            const buttons = [
              [
                { text: '✅ Accept', callback_data: encodeCallback('a', { id: decoded.id }) },
                { text: '✏️ Revise', callback_data: encodeCallback('r', { id: decoded.id }) },
                { text: '🗑️ Discard', callback_data: encodeCallback('x', { id: decoded.id }) },
              ],
            ];
            await responseContext.updateMessage(event.messageId, { choices: buttons });
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
          autoAcceptPending: true,
          responseContext,
        });
      }
      default:
        this.logger.warn?.('nutribot.command.unknown', { command });
        return { ok: true, handled: false };
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
    // Debug: Log resolution attempt
    this.logger.debug?.('nutribot.resolveUserId.attempt', {
      hasUserResolver: !!this.#userResolver,
      platform: event.platform,
      platformUserId: event.platformUserId,
      conversationId: event.conversationId,
    });

    if (this.#userResolver && event.platform && event.platformUserId) {
      const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
      if (username) {
        this.logger.debug?.('nutribot.resolveUserId.resolved', { username, platformUserId: event.platformUserId });
        return username;
      }
      this.logger.warn?.('nutribot.userResolver.notFound', {
        platform: event.platform,
        platformUserId: event.platformUserId,
        fallback: event.conversationId,
      });
    } else {
      // Log which condition failed
      this.logger.warn?.('nutribot.resolveUserId.skipResolution', {
        hasUserResolver: !!this.#userResolver,
        hasPlatform: !!event.platform,
        hasPlatformUserId: !!event.platformUserId,
        fallback: event.conversationId,
      });
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
