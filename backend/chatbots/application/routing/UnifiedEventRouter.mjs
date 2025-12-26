/**
 * Unified Event Router
 * @module application/routing/UnifiedEventRouter
 * 
 * Routes platform-agnostic InputEvents to appropriate use cases.
 * This router is shared between CLI, Telegram, and other platforms.
 * 
 * Key responsibilities:
 * - Parse callback data into action + params
 * - Check conversation state for context (revision flow, etc.)
 * - Route to appropriate use case
 * - Handle edge cases gracefully
 */

import { createLogger } from '../../_lib/logging/index.mjs';
import { decodeCallback } from '../../_lib/callback.mjs';
import { InputEventType } from '../ports/IInputEvent.mjs';

/**
 * Unified Event Router
 * Routes InputEvents to NutriBot use cases
 */
export class UnifiedEventRouter {
  #container;
  #logger;

  /**
   * @param {import('../../nutribot/container.mjs').NutribotContainer} container
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || createLogger({ source: 'router', app: 'unified' });
  }

  /**
   * Route an InputEvent to the appropriate use case
   * @param {import('../ports/IInputEvent.mjs').IInputEvent} event
   * @returns {Promise<any>}
   */
  async route(event) {
    const { type, userId, conversationId, messageId, payload } = event;

    this.#logger.debug('router.event', { type, conversationId, messageId });

    try {
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(conversationId, payload.text, messageId);

        case InputEventType.IMAGE:
          return this.#handleImage(conversationId, payload, messageId);

        case InputEventType.VOICE:
          return this.#handleVoice(conversationId, payload, messageId);

        case InputEventType.UPC:
          return this.#handleUPC(conversationId, payload.upc, messageId);

        case InputEventType.COMMAND:
          return this.#handleCommand(conversationId, payload.command, messageId);

        case InputEventType.CALLBACK:
          return this.#handleCallback(conversationId, payload.data, payload.sourceMessageId);

        default:
          this.#logger.warn('router.unknownEventType', { type });
          return null;
      }
    } catch (error) {
      this.#logger.error('router.error', { 
        type, 
        conversationId, 
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  // ==================== Input Handlers ====================

  /**
   * Handle text input
   * @private
   */
  async #handleText(conversationId, text, messageId) {
    this.#logger.debug('router.text', { conversationId, textLength: text?.length });

    // Check conversation state for revision flow
    const conversationStateStore = this.#container.getConversationStateStore();
    
    // CRITICAL DEBUG: Log state store availability at INFO level
    this.#logger.info('router.text.stateStoreCheck', { 
      hasStateStore: !!conversationStateStore,
      stateStoreType: conversationStateStore?.constructor?.name || 'none',
      conversationId,
    });
    
    if (conversationStateStore) {
      const state = await conversationStateStore.get(conversationId);
      
      // CRITICAL DEBUG: Log state lookup result at INFO level
      this.#logger.info('router.text.stateLookup', { 
        conversationId,
        hasState: !!state,
        activeFlow: state?.activeFlow || 'none',
        hasPendingLogUuid: !!state?.flowState?.pendingLogUuid,
        pendingLogUuid: state?.flowState?.pendingLogUuid || 'none',
      });
      
      // Check activeFlow (not flow) - this is what ReviseFoodLog sets
      if (state?.activeFlow === 'revision' && state?.flowState?.pendingLogUuid) {
        this.#logger.info('router.text.revisionDetected', { logUuid: state.flowState.pendingLogUuid });
        const useCase = this.#container.getProcessRevisionInput();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          text,
          messageId,
        });
      }
    }

    // Regular food logging
    const useCase = this.#container.getLogFoodFromText();
    return useCase.execute({
      userId: conversationId,
      conversationId,
      text,
      messageId,
    });
  }

  /**
   * Handle image input
   * @private
   */
  async #handleImage(conversationId, payload, messageId) {
    this.#logger.debug('router.image', { conversationId, hasFileId: !!payload.fileId });

    const useCase = this.#container.getLogFoodFromImage();
    return useCase.execute({
      userId: conversationId,
      conversationId,
      imageData: { 
        fileId: payload.fileId,
        url: payload.url,
      },
      messageId,
    });
  }

  /**
   * Handle voice input
   * @private
   */
  async #handleVoice(conversationId, payload, messageId) {
    this.#logger.debug('router.voice', { conversationId, duration: payload.duration });

    const useCase = this.#container.getLogFoodFromVoice();
    return useCase.execute({
      userId: conversationId,
      conversationId,
      voiceData: { 
        fileId: payload.fileId,
        duration: payload.duration,
      },
      messageId,
    });
  }

  /**
   * Handle UPC code input
   * @private
   */
  async #handleUPC(conversationId, upc, messageId) {
    this.#logger.debug('router.upc', { conversationId, upc });

    const useCase = this.#container.getLogFoodFromUPC();
    return useCase.execute({
      userId: conversationId,
      conversationId,
      upc,
      messageId,
    });
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(conversationId, command, messageId) {
    this.#logger.debug('router.command', { conversationId, command });

    let result;

    switch (command) {
      case 'help':
      case 'start': {
        const useCase = this.#container.getHandleHelpCommand();
        result = await useCase.execute({ conversationId, messageId });
        break;
      }

      case 'report': {
        const useCase = this.#container.getGenerateDailyReport();
        result = await useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
          autoAcceptPending: true, // Auto-confirm all pending items when user requests report
        });
        break;
      }

      case 'review':
      case 'adjust': {
        const useCase = this.#container.getStartAdjustmentFlow();
        result = await useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
        });
        break;
      }

      case 'coach': {
        const useCase = this.#container.getGenerateOnDemandCoaching();
        result = await useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
        });
        break;
      }

      case 'confirm': {
        const useCase = this.#container.getConfirmAllPending();
        result = await useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
        });
        break;
      }

      default:
        // Unknown command - treat as text
        this.#logger.debug('router.command.unknown', { command });
        result = await this.#handleText(conversationId, `/${command}`, messageId);
    }

    await this.#deleteIncomingMessage(conversationId, messageId);
    return result;
  }

  async #deleteIncomingMessage(conversationId, messageId) {
    if (!messageId) return;
    try {
      const gateway = this.#container.getMessagingGateway?.();
      if (!gateway?.deleteMessage) return;
      await gateway.deleteMessage(conversationId, messageId);
      this.#logger.debug('router.command.deletedSource', { conversationId, messageId });
    } catch (err) {
      this.#logger.warn('router.command.deleteFailed', { conversationId, messageId, error: err.message });
    }
  }

  /**
   * Handle callback/button press
   * @private
   */
  async #handleCallback(conversationId, callbackData, sourceMessageId) {
    this.#logger.debug('router.callback', { conversationId, callbackData, sourceMessageId });

    const payload = decodeCallback(callbackData);
    if (!payload || payload.legacy) {
      this.#logger.warn('router.callback.unparsed', { conversationId, callbackData });
      return null;
    }

    const action = payload.a || payload.action;
    if (!action) {
      this.#logger.warn('router.callback.missingAction', { conversationId, callbackData });
      return null;
    }

    // Adjustment + report routes use short action keys
    switch (action) {
      case 'dt': {
        const useCase = this.#container.getSelectDateForAdjustment();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          daysAgo: payload.d ?? 0,
          offset: payload.o ?? 0,
        });
      }

      case 'pg': {
        const useCase = this.#container.getSelectDateForAdjustment();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          daysAgo: payload.d ?? 0,
          offset: payload.o ?? 0,
        });
      }

      case 'bd': {
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
        });
      }

      case 'i': {
        const useCase = this.#container.getSelectItemForAdjustment();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          itemId: payload.id,
        });
      }

      case 'bi': {
        const conversationStateStore = this.#container.getConversationStateStore();
        const state = await conversationStateStore?.get(conversationId);
        const daysAgo = state?.flowState?.daysAgo ?? 0;
        const offset = state?.flowState?.offset ?? 0;
        const useCase = this.#container.getSelectDateForAdjustment();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          daysAgo,
          offset,
        });
      }

      case 'f': {
        const useCase = this.#container.getApplyPortionAdjustment();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          factor: payload.f ?? 1,
          itemId: payload.id,
        });
      }

      case 'd': {
        const useCase = this.#container.getDeleteListItem();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
          itemId: payload.id,
        });
      }

      case 'm': {
        const messagingGateway = this.#container.getMessagingGateway();
        await messagingGateway.sendMessage(
          conversationId,
          '📅 Move to another day is coming soon!',
          { choices: [[{ text: '↩️ Back', callback_data: callbackData }]] }
        );
        return { success: true, pending: true };
      }

      case 'dn': {
        const useCase = this.#container.getGenerateDailyReport();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
        });
      }

      case 'p': {
        const useCase = this.#container.getSelectUPCPortion();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid: payload.id,
          portionFactor: payload.f ?? 1,
          messageId: sourceMessageId,
        });
      }

      case 'a': {
        const useCase = this.#container.getAcceptFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid: payload.id,
          messageId: sourceMessageId,
        });
      }

      case 'x': {
        const useCase = this.#container.getDiscardFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid: payload.id,
          messageId: sourceMessageId,
        });
      }

      case 'r': {
        const useCase = this.#container.getReviseFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid: payload.id,
          messageId: sourceMessageId,
        });
      }

      case 'cr': {
        const conversationStateStore = this.#container.getConversationStateStore();
        await conversationStateStore?.clearFlow?.(conversationId, 'revision');
        if (sourceMessageId) {
          try {
            const messagingGateway = this.#container.getMessagingGateway();
            await messagingGateway.updateMessage(conversationId, sourceMessageId, { choices: [] });
          } catch (e) {
            this.#logger.warn('router.revision.cancelUpdateFailed', { error: e.message });
          }
        }
        return { success: true, cancelled: true };
      }

      case 'ra': {
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId: sourceMessageId,
        });
      }

      case 'rx': {
        try {
          const messagingGateway = this.#container.getMessagingGateway();
          await messagingGateway.updateMessage(conversationId, sourceMessageId, { choices: [] });
          this.#logger.info('report.accepted', { conversationId, sourceMessageId });

          // Trigger post-report coaching
          const coachingUseCase = this.#container.getGenerateReportCoaching?.();
          if (coachingUseCase) {
            await coachingUseCase.execute({ userId: conversationId, conversationId });
          }
        } catch (e) {
          this.#logger.warn('report.accept.error', { error: e.message });
        }
        return { success: true };
      }

      default:
        this.#logger.warn('router.callback.unknown', { action, payload });
        return null;
    }
  }

  // ==================== Utility Methods ====================

  /**
   * Get the container for testing/debugging
   * @returns {Object}
   */
  getContainer() {
    return this.#container;
  }
}

export default UnifiedEventRouter;
