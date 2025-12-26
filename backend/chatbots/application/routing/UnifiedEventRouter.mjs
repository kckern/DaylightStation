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

    // Parse callback data (format: "action" or "action:param1:param2")
    const [action, ...params] = callbackData.split(':');

    // Handle adjustment flow callbacks (adj_*)
    if (action.startsWith('adj_')) {
      return this.#handleAdjustmentCallback(conversationId, action, params, sourceMessageId);
    }

    // Handle report callbacks (report_*)
    if (action.startsWith('report_')) {
      return this.#handleReportCallback(conversationId, action, params, sourceMessageId);
    }

    // Handle standard actions
    switch (action) {
      // Accept variants
      case 'accept':
      case '✅':
      case 'Accept': {
        const logUuid = params[0];
        const useCase = this.#container.getAcceptFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid,
          messageId: sourceMessageId,
        });
      }

      // Discard variants
      case 'discard':
      case '🗑️':
      case 'Discard': {
        const logUuid = params[0];
        const useCase = this.#container.getDiscardFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid,
          messageId: sourceMessageId,
        });
      }

      // Revise variants
      case 'revise':
      case '✏️':
      case 'Revise': {
        const logUuid = params[0];
        const useCase = this.#container.getReviseFoodLog();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid,
          messageId: sourceMessageId,
        });
      }

      // UPC portion selection (format: portion:UUID:factor)
      case 'portion': {
        const logUuid = params[0];
        const factor = parseFloat(params[1]) || 1;
        const useCase = this.#container.getSelectUPCPortion();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          logUuid,
          portionFactor: factor,
          messageId: sourceMessageId,
        });
      }

      // Legacy numeric portion selection (for UPC items)
      default: {
        const factor = parseFloat(action);
        if (!isNaN(factor) && factor > 0) {
          const useCase = this.#container.getSelectUPCPortion();
          return useCase.execute({
            userId: conversationId,
            conversationId,
            portionFactor: factor,
            messageId: sourceMessageId,
          });
        }
        
        this.#logger.warn('router.callback.unknown', { action, callbackData });
        return null;
      }
    }
  }

  /**
   * Handle adjustment flow callbacks
   * @private
   */
  async #handleAdjustmentCallback(conversationId, action, params, messageId) {
    this.#logger.debug('router.adjustment', { action, params, messageId });

    // Start adjustment flow
    if (action === 'adj_start') {
      const useCase = this.#container.getStartAdjustmentFlow();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
      });
    }

    // Done - exit adjustment flow
    if (action === 'adj_done') {
      // Generate report to show final state
      const useCase = this.#container.getGenerateDailyReport();
      return useCase.execute({
        userId: conversationId,
        conversationId,
      });
    }

    // Date selection: adj_date or adj_date_X (days ago)
    if (action === 'adj_date' || action.startsWith('adj_date_')) {
      const daysAgo = action === 'adj_date' 
        ? parseInt(params[0], 10) || 0
        : parseInt(action.replace('adj_date_', ''), 10) || 0;
      
      const useCase = this.#container.getSelectDateForAdjustment();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        daysAgo,
      });
    }

    // Back to date selection
    if (action === 'adj_back_date') {
      const useCase = this.#container.getStartAdjustmentFlow();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
      });
    }

    // Item selection: adj_item or adj_item_X
    if (action === 'adj_item' || action.startsWith('adj_item_')) {
      const itemId = action === 'adj_item'
        ? params[0]
        : action.replace('adj_item_', '');
      
      const useCase = this.#container.getSelectItemForAdjustment();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        itemId,
      });
    }

    // Back to items list
    if (action === 'adj_back_items') {
      // Re-select the current date to show items
      const conversationStateStore = this.#container.getConversationStateStore();
      const state = await conversationStateStore?.get(conversationId);
      const daysAgo = state?.flowState?.daysAgo ?? 0;
      
      const useCase = this.#container.getSelectDateForAdjustment();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        daysAgo,
      });
    }

    // Portion adjustment: adj_factor_X_uuid
    if (action === 'adj_factor' || action.startsWith('adj_factor_')) {
      // Parse factor and optional itemId: adj_factor_0.5_uuid or adj_factor_0.5
      const factorPart = action.replace('adj_factor_', '');
      const underscoreIdx = factorPart.indexOf('_');
      let factor, itemId;
      if (underscoreIdx > 0) {
        factor = parseFloat(factorPart.substring(0, underscoreIdx)) || 1;
        itemId = factorPart.substring(underscoreIdx + 1);
      } else {
        factor = parseFloat(factorPart) || parseFloat(params[0]) || 1;
        itemId = params[1] || undefined;
      }
      
      const useCase = this.#container.getApplyPortionAdjustment();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        factor,
        itemId,
      });
    }

    // Delete item
    if (action === 'adj_delete' || action.startsWith('adj_delete_')) {
      const itemId = action === 'adj_delete'
        ? params[0]
        : action.replace('adj_delete_', '');
      const useCase = this.#container.getDeleteListItem();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        itemId,
      });
    }

    // Move day - show date picker: adj_move_uuid
    if (action.startsWith('adj_move_') && !action.startsWith('adj_move_date_')) {
      const itemId = action.replace('adj_move_', '');
      // Show date selection for moving this item
      // For now, just send a message that this feature is coming
      await this.#container.getMessagingGateway().sendMessage(
        conversationId,
        '📅 Move to another day is coming soon!',
        { choices: [[{ text: '↩️ Back', callback_data: `adj_item_${itemId}` }]] }
      );
      return { success: true, pending: true };
    }

    // Pagination: adj_page_daysAgo_offset or adj_page_offset (legacy)
    if (action.startsWith('adj_page_')) {
      const pagePart = action.replace('adj_page_', '');
      const parts = pagePart.split('_');
      let daysAgo, offset;
      
      if (parts.length >= 2) {
        // New format: adj_page_daysAgo_offset
        daysAgo = parseInt(parts[0], 10) || 0;
        offset = parseInt(parts[1], 10) || 0;
      } else {
        // Legacy format: adj_page_offset - fall back to state for daysAgo
        offset = parseInt(parts[0], 10) || 0;
        const conversationStateStore = this.#container.getConversationStateStore();
        const state = await conversationStateStore?.get(conversationId);
        daysAgo = state?.flowState?.daysAgo ?? 0;
      }
      
      const useCase = this.#container.getSelectDateForAdjustment();
      return useCase.execute({
        userId: conversationId,
        conversationId,
        messageId,
        daysAgo,
        offset,
      });
    }

    // Move to date
    if (action === 'adj_move_date') {
      const date = params[0];
      const useCase = this.#container.getMoveItemToDate?.();
      if (useCase) {
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
          date,
        });
      }
    }

    this.#logger.warn('router.adjustment.unknown', { action, params });
    return null;
  }

  /**
   * Handle report callbacks (report_adjust, report_accept)
   * @private
   */
  async #handleReportCallback(conversationId, action, params, messageId) {
    this.#logger.debug('router.report', { action, params, messageId });

    switch (action) {
      case 'report_adjust': {
        // Start adjustment flow for the report's date
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: conversationId,
          conversationId,
          messageId,
        });
      }

      case 'report_accept': {
        // Accept the report - just remove the buttons
        try {
          const messagingGateway = this.#container.getMessagingGateway();
          await messagingGateway.updateMessage(conversationId, messageId, {
            choices: [], // Remove buttons
          });
          this.#logger.info('report.accepted', { conversationId, messageId });
        } catch (e) {
          this.#logger.warn('report.accept.error', { error: e.message });
        }
        return { success: true };
      }

      default:
        this.#logger.warn('router.report.unknown', { action, params });
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
