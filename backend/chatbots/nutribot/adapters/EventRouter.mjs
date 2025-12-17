/**
 * NutriBot Event Router
 * @module nutribot/adapters/EventRouter
 * 
 * Routes webhook events to appropriate use cases.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

// UPC pattern: 8-14 digits, potentially with dashes
const UPC_PATTERN = /^\d[\d-]{6,13}\d$/;

/**
 * NutriBot Event Router
 */
export class NutribotEventRouter {
  #container;
  #logger;
  #botId;

  /**
   * @param {import('../container.mjs').NutribotContainer} container
   */
  constructor(container) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = createLogger({ source: 'router', app: 'nutribot' });
    // Get botId from container config for constructing ConversationId
    this.#botId = container.getConfig?.()?.telegram?.botId || process.env.NUTRIBOT_TELEGRAM_BOT_ID || '6898194425';
  }

  /**
   * Build a conversationId string from Telegram chatId
   * @private
   * @param {string} chatId - Telegram chat ID
   * @returns {string} - Format: "telegram:{botId}_{chatId}"
   */
  #buildConversationId(chatId) {
    return `telegram:${this.#botId}_${chatId}`;
  }

  /**
   * Route webhook event to appropriate handler
   * @param {Object} event - Telegram webhook event
   */
  async route(event) {
    const { message, callback_query, edited_message } = event;

    try {
      if (message) {
        return this.#routeMessage(message);
      }

      if (callback_query) {
        return this.#routeCallback(callback_query);
      }

      if (edited_message) {
        // Ignore edited messages for now
        this.#logger.debug('router.ignoredEdit', { messageId: edited_message.message_id });
        return;
      }

      this.#logger.warn('router.unknownEvent', { keys: Object.keys(event) });
    } catch (error) {
      this.#logger.error('router.error', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Route message events
   * @private
   */
  async #routeMessage(message) {
    const chatId = String(message.chat.id);
    const messageId = String(message.message_id);
    const from = message.from || {};

    // Photo message
    if (message.photo && message.photo.length > 0) {
      return this.#handlePhoto(chatId, message.photo, messageId);
    }

    // Voice message
    if (message.voice) {
      return this.#handleVoice(chatId, message.voice, messageId, from);
    }

    // Text message
    if (message.text) {
      const text = message.text.trim();

      // Check for slash command
      if (text.startsWith('/')) {
        return this.#handleCommand(chatId, text, messageId);
      }

      // Check for UPC pattern
      if (UPC_PATTERN.test(text.replace(/-/g, ''))) {
        return this.#handleUPC(chatId, text, messageId);
      }

      // Regular text
      return this.#handleText(chatId, text, messageId, from);
    }

    this.#logger.debug('router.unhandledMessage', { chatId, type: this.#getMessageType(message) });
  }

  /**
   * Route callback query events
   * @private
   */
  async #routeCallback(callbackQuery) {
    const chatId = String(callbackQuery.message?.chat?.id);
    const messageId = String(callbackQuery.message?.message_id);
    const data = callbackQuery.data;
    const message = callbackQuery.message;

    if (!chatId || !data) {
      this.#logger.warn('router.invalidCallback', { hasChat: !!chatId, hasData: !!data });
      return;
    }

    return this.#handleCallback(chatId, messageId, data, message);
  }

  // ==================== Message Handlers ====================

  /**
   * Handle photo message
   * @private
   */
  async #handlePhoto(chatId, photos, messageId) {
    this.#logger.debug('router.photo', { chatId, photoCount: photos.length });

    // Get largest photo (last in array)
    const photo = photos[photos.length - 1];
    const fileId = photo.file_id;

    const useCase = this.#container.getLogFoodFromImage();
    return useCase.execute({
      userId: chatId,
      conversationId: this.#buildConversationId(chatId),
      imageData: { fileId },
      messageId,
    });
  }

  /**
   * Handle UPC code
   * @private
   */
  async #handleUPC(chatId, upc, messageId) {
    this.#logger.debug('router.upc', { chatId, upc });

    // Clean UPC (remove dashes)
    const cleanUPC = upc.replace(/-/g, '');

    const useCase = this.#container.getLogFoodFromUPC();
    return useCase.execute({
      userId: chatId,
      conversationId: this.#buildConversationId(chatId),
      upc: cleanUPC,
      messageId,
    });
  }

  /**
   * Handle text message
   * @private
   */
  async #handleText(chatId, text, messageId, from) {
    this.#logger.debug('router.text', { chatId, text, textLength: text.length });

    const conversationId = this.#buildConversationId(chatId);

    // Check conversation state for revising
    const conversationStateStore = this.#container.getConversationStateStore();
    const state = await conversationStateStore.get(conversationId);
    
    // DEBUG: Log state lookup result with text content
    this.#logger.debug('router.text.stateLookup', {
      conversationId,
      text,
      hasState: !!state,
      activeFlow: state?.activeFlow || 'none',
      hasPendingLogUuid: !!state?.flowState?.pendingLogUuid,
    });

    // Check if in revision mode OR if there's a pending log (implicit revision)
    // When user sends text while a pending log exists, treat it as a revision
    const isRevisionMode = state?.activeFlow === 'revision' && state?.flowState?.pendingLogUuid;
    const hasPendingLog = (state?.activeFlow === 'food_confirmation' || state?.activeFlow === 'revision') && state?.flowState?.pendingLogUuid;
    
    if (isRevisionMode || hasPendingLog) {
      this.#logger.info('router.text.revisionDetected', { 
        logUuid: state.flowState.pendingLogUuid, 
        text,
        implicit: !isRevisionMode && hasPendingLog,
      });
      const useCase = this.#container.getProcessRevisionInput();
      return useCase.execute({
        userId: chatId,
        conversationId,
        text,
        messageId,
      });
    }

    // Regular food logging
    this.#logger.debug('router.text.foodLogging', { conversationId, text });
    const useCase = this.#container.getLogFoodFromText();
    return useCase.execute({
      userId: chatId,
      conversationId,
      text,
      messageId,
    });
  }

  /**
   * Handle voice message
   * @private
   */
  async #handleVoice(chatId, voice, messageId, from) {
    this.#logger.debug('router.voice', { chatId, duration: voice.duration });

    const conversationId = this.#buildConversationId(chatId);

    // Check conversation state for revision mode (same as text handler)
    const conversationStateStore = this.#container.getConversationStateStore();
    const state = await conversationStateStore.get(conversationId);

    this.#logger.info('router.voice.stateLookup', {
      conversationId,
      hasState: !!state,
      activeFlow: state?.activeFlow || 'none',
      hasPendingLogUuid: !!state?.flowState?.pendingLogUuid,
    });

    // Check if in revision mode OR if there's a pending log (implicit revision)
    const isRevisionMode = state?.activeFlow === 'revision' && state?.flowState?.pendingLogUuid;
    const hasPendingLog = (state?.activeFlow === 'food_confirmation' || state?.activeFlow === 'revision') && state?.flowState?.pendingLogUuid;
    
    // If in revision mode or has pending log, transcribe first then process as revision
    if (isRevisionMode || hasPendingLog) {
      this.#logger.info('router.voice.revisionDetected', { 
        logUuid: state.flowState.pendingLogUuid,
        implicit: !isRevisionMode && hasPendingLog,
      });
      
      // Need to transcribe voice first
      const messagingGateway = this.#container.getMessagingGateway();
      
      // Delete original voice message
      if (messageId) {
        try {
          await messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      // Transcribe
      let transcription;
      if (messagingGateway.transcribeVoice) {
        transcription = await messagingGateway.transcribeVoice(voice.file_id);
      }

      if (!transcription || transcription.trim().length === 0) {
        await messagingGateway.sendMessage(
          conversationId,
          '❓ I couldn\'t understand the voice message. Please type your revision.',
          {}
        );
        return { success: false, error: 'Empty transcription' };
      }

      // Process as revision
      const useCase = this.#container.getProcessRevisionInput();
      return useCase.execute({
        userId: chatId,
        conversationId,
        text: transcription,
      });
    }

    // Regular voice food logging
    const useCase = this.#container.getLogFoodFromVoice();
    return useCase.execute({
      userId: chatId,
      conversationId,
      voiceData: { fileId: voice.file_id },
      messageId,
    });
  }

  /**
   * Handle callback query
   * @private
   */
  async #handleCallback(chatId, messageId, data, message) {
    this.#logger.debug('router.callback', { chatId, data });

    // Parse callback data
    const [action, ...params] = data.split(':');

    switch (action) {
      case 'accept':
      case '✅':
      case 'Accept': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getAcceptFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          logUuid,
          messageId,
        });
      }

      case 'discard':
      case '🗑️':
      case 'Discard': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getDiscardFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          logUuid,
          messageId,
        });
      }

      case 'revise':
      case '✏️':
      case 'Revise': {
        const logUuid = params[0] || this.#extractLogUuidFromMessage(message);
        const useCase = this.#container.getReviseFoodLog();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          logUuid,
          messageId,
        });
      }

      case 'cancel_revision': {
        // Cancel revision mode - restore original message with Accept/Revise/Discard buttons
        const logUuid = params[0];
        const conversationId = this.#buildConversationId(chatId);
        
        // Clear revision state
        const conversationStateStore = this.#container.getConversationStateStore();
        const { ConversationState } = await import('../../domain/entities/ConversationState.mjs');
        const newState = ConversationState.create(conversationId, {
          activeFlow: 'food_confirmation',
          flowState: { pendingLogUuid: logUuid },
        });
        await conversationStateStore.set(conversationId, newState);

        // Get the log to rebuild the message
        const nutrilogRepository = this.#container.getNutrilogRepository();
        const nutriLog = await nutrilogRepository.findByUuid(logUuid);
        
        if (!nutriLog) {
          this.#logger.warn('router.cancelRevision.logNotFound', { logUuid });
          return { success: false, error: 'Log not found' };
        }

        // Rebuild the original message
        const { formatFoodList, formatDateHeader } = await import('../domain/formatters.mjs');
        const config = this.#container.getConfig?.();
        const timezone = config?.getDefaultTimezone?.() || config?.weather?.timezone || 'America/Los_Angeles';
        
        const logDate = nutriLog.meal?.date || nutriLog.date;
        const dateHeader = logDate ? formatDateHeader(logDate, { timezone }) : '';
        const foodList = formatFoodList(nutriLog.items || []);
        const messageText = dateHeader ? `${dateHeader}\n\n${foodList}` : foodList;

        const messagingGateway = this.#container.getMessagingGateway();
        await messagingGateway.updateMessage(conversationId, messageId, {
          text: messageText,
          choices: [
            [
              { text: '✅ Accept', callback_data: `accept:${logUuid}` },
              { text: '✏️ Revise', callback_data: `revise:${logUuid}` },
              { text: '🗑️ Discard', callback_data: `discard:${logUuid}` },
            ],
          ],
          inline: true,
        });

        this.#logger.info('router.cancelRevision.complete', { conversationId, logUuid });
        return { success: true };
      }

      case 'portion': {
        const factor = parseFloat(params[0]) || 1;
        const useCase = this.#container.getSelectUPCPortion();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          portionFactor: factor,
          messageId,
        });
      }

      case 'adjust_date': {
        const useCase = this.#container.getSelectDateForAdjustment();
        const date = params[0];
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          date,
        });
      }

      case 'adjust_item': {
        const itemUuid = params[0];
        const useCase = this.#container.getSelectItemForAdjustment();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          itemUuid,
        });
      }

      case 'adjust_portion': {
        const factor = parseFloat(params[0]) || 1;
        const useCase = this.#container.getApplyPortionAdjustment();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          factor,
        });
      }

      case 'delete_item': {
        const itemUuid = params[0];
        const useCase = this.#container.getDeleteListItem();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          itemUuid,
        });
      }

      case 'report_adjust': {
        // Start adjustment flow from report
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          messageId,
        });
      }

      case 'report_accept': {
        // Accept report - just remove the buttons
        const messagingGateway = this.#container.getMessagingGateway();
        await messagingGateway.updateMessage(
          this.#buildConversationId(chatId),
          messageId,
          {
            choices: [], // Remove buttons
            inline: true,
          }
        );
        this.#logger.info('router.reportAccept', { chatId, messageId });
        return { success: true };
      }

      case 'adj_date_0':
      case 'adj_date_1':
      case 'adj_date_2':
      case 'adj_date_3':
      case 'adj_date_4':
      case 'adj_date_5':
      case 'adj_date_6':
      case 'adj_date_7': {
        // Handle date selection from adjustment flow
        const daysAgo = parseInt(action.split('_')[2], 10);
        
        const useCase = this.#container.getSelectDateForAdjustment();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          daysAgo,
          messageId,
        });
      }

      case 'adj_back_date': {
        // Go back to date selection
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: chatId,
          conversationId: this.#buildConversationId(chatId),
          messageId,
        });
      }

      case 'adj_done': {
        // Done with adjustment - restore report buttons
        const messagingGateway = this.#container.getMessagingGateway();
        await messagingGateway.updateMessage(
          this.#buildConversationId(chatId),
          messageId,
          {
            choices: [
              [
                { text: '✏️ Adjust', callback_data: 'report_adjust' },
                { text: '✅ Accept', callback_data: 'report_accept' },
              ],
            ],
            inline: true,
          }
        );
        
        // Clear adjustment state
        const conversationStateStore = this.#container.getConversationStateStore();
        await conversationStateStore.clear(this.#buildConversationId(chatId));
        
        this.#logger.info('router.adjDone', { chatId, messageId });
        return { success: true };
      }

      default: {
        // Handle dynamic patterns that can't be matched with case statements
        
        // adj_item_{uuid} - Item selection in adjustment flow
        if (action.startsWith('adj_item_')) {
          const itemUuid = action.replace('adj_item_', '');
          this.#logger.debug('router.adjItem', { chatId, itemUuid });
          
          const conversationId = this.#buildConversationId(chatId);
          const conversationStateStore = this.#container.getConversationStateStore();
          const state = await conversationStateStore.get(conversationId);
          const originMessageId = state?.flowState?.originMessageId || messageId;
          
          // Get the item details from nutrilist
          const nutrilistRepository = this.#container.getNutrilistRepository();
          let itemCaption = '↕️ Adjust portion:';
          
          if (nutrilistRepository?.findByUuid) {
            const item = await nutrilistRepository.findByUuid(chatId, itemUuid);
            if (item) {
              const emoji = item.noom_color === 'green' ? '🟢' : item.noom_color === 'yellow' ? '🟡' : item.noom_color === 'orange' ? '🟠' : '⚪';
              const name = item.name || item.item || item.label || 'Item';
              const grams = item.grams || item.amount || 0;
              const calories = item.calories || 0;
              itemCaption = `${emoji} <b>${name}</b>\n${grams}g • ${calories} cal\n\n↕️ How to adjust?`;
            }
          }
          
          // Update state with selected item
          await conversationStateStore.update(conversationId, {
            step: 'portion_selection',
            data: { ...state?.flowState?.data, selectedItemUuid: itemUuid },
          });
          
          // Show portion adjustment options
          const messagingGateway = this.#container.getMessagingGateway();
          await messagingGateway.updateMessage(conversationId, originMessageId, {
            caption: itemCaption,
            parseMode: 'HTML',
            choices: [
              [
                { text: '¼', callback_data: `adj_portion_0.25_${itemUuid}` },
                { text: '⅓', callback_data: `adj_portion_0.33_${itemUuid}` },
                { text: '½', callback_data: `adj_portion_0.5_${itemUuid}` },
                { text: '⅔', callback_data: `adj_portion_0.67_${itemUuid}` },
                { text: '¾', callback_data: `adj_portion_0.75_${itemUuid}` },
              ],
              [
                { text: '×1¼', callback_data: `adj_portion_1.25_${itemUuid}` },
                { text: '×1½', callback_data: `adj_portion_1.5_${itemUuid}` },
                { text: '×2', callback_data: `adj_portion_2_${itemUuid}` },
                { text: '×3', callback_data: `adj_portion_3_${itemUuid}` },
                { text: '×4', callback_data: `adj_portion_4_${itemUuid}` },
              ],
              [
                { text: '🗑️ Delete', callback_data: `adj_delete_${itemUuid}` },
                { text: '↩️ Back', callback_data: 'adj_back_items' },
              ],
            ],
          });
          return { success: true };
        }
        
        // adj_page_{offset} - Pagination in adjustment flow
        if (action.startsWith('adj_page_')) {
          const offset = parseInt(action.replace('adj_page_', ''), 10);
          const conversationId = this.#buildConversationId(chatId);
          const conversationStateStore = this.#container.getConversationStateStore();
          const state = await conversationStateStore.get(conversationId);
          const daysAgo = state?.flowState?.data?.daysAgo || 0;
          
          const useCase = this.#container.getSelectDateForAdjustment();
          return useCase.execute({
            userId: chatId,
            conversationId,
            daysAgo,
            offset,
            messageId,
          });
        }
        
        // adj_portion_{factor}_{uuid} - Apply portion adjustment
        if (action.startsWith('adj_portion_')) {
          const parts = action.replace('adj_portion_', '').split('_');
          const factor = parseFloat(parts[0]);
          const itemUuid = parts[1];
          
          this.#logger.debug('router.adjPortion', { chatId, factor, itemUuid });
          
          // Apply the adjustment to the nutrilist item
          const nutrilistRepository = this.#container.getNutrilistRepository();
          const conversationId = this.#buildConversationId(chatId);
          
          if (nutrilistRepository?.updatePortion) {
            await nutrilistRepository.updatePortion(chatId, itemUuid, factor);
          }
          
          // Clear adjustment state
          const conversationStateStore = this.#container.getConversationStateStore();
          await conversationStateStore.clear(conversationId);
          
          // Trigger report regeneration
          const generateReportUseCase = this.#container.getGenerateDailyReport();
          if (generateReportUseCase) {
            return generateReportUseCase.execute({
              userId: chatId,
              conversationId,
              deletePreviousReport: true,
              previousReportMessageId: messageId,
            });
          }
          
          return { success: true };
        }
        
        // adj_delete_{uuid} - Delete item
        if (action.startsWith('adj_delete_')) {
          const itemUuid = action.replace('adj_delete_', '');
          
          this.#logger.debug('router.adjDelete', { chatId, itemUuid });
          
          const nutrilistRepository = this.#container.getNutrilistRepository();
          const conversationId = this.#buildConversationId(chatId);
          
          if (nutrilistRepository?.deleteById) {
            await nutrilistRepository.deleteById(chatId, itemUuid);
          }
          
          // Clear adjustment state
          const conversationStateStore = this.#container.getConversationStateStore();
          await conversationStateStore.clear(conversationId);
          
          // Trigger report regeneration
          const generateReportUseCase = this.#container.getGenerateDailyReport();
          if (generateReportUseCase) {
            return generateReportUseCase.execute({
              userId: chatId,
              conversationId,
              deletePreviousReport: true,
              previousReportMessageId: messageId,
            });
          }
          
          return { success: true };
        }
        
        // adj_back_items - Go back to item list from portion selection
        if (action === 'adj_back_items') {
          const conversationId = this.#buildConversationId(chatId);
          const conversationStateStore = this.#container.getConversationStateStore();
          const state = await conversationStateStore.get(conversationId);
          const daysAgo = state?.flowState?.data?.daysAgo || 0;
          
          const useCase = this.#container.getSelectDateForAdjustment();
          return useCase.execute({
            userId: chatId,
            conversationId,
            daysAgo,
            messageId,
          });
        }
        
        this.#logger.warn('router.unknownCallback', { chatId, action, data });
        return;
      }
    }
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(chatId, command, messageId) {
    const cmd = command.slice(1).toLowerCase().split(/\s+/)[0];
    this.#logger.debug('router.command', { chatId, command: cmd, messageId });

    // Delete the command message
    const conversationId = this.#buildConversationId(chatId);
    if (messageId) {
      try {
        const messagingGateway = this.#container.getMessagingGateway();
        await messagingGateway.deleteMessage(conversationId, messageId);
        this.#logger.debug('router.command.deleted', { chatId, messageId });
      } catch (e) {
        this.#logger.warn('router.command.deleteFailed', { chatId, messageId, error: e.message });
      }
    }

    switch (cmd) {
      case 'help':
      case 'start': {
        const useCase = this.#container.getHandleHelpCommand();
        return useCase.execute({ conversationId });
      }

      case 'report': {
        // Auto-accept all pending logs and generate report
        const confirmUseCase = this.#container.getConfirmAllPending();
        const confirmResult = await confirmUseCase.execute({
          userId: chatId,
          conversationId,
        });
        
        // If nothing was confirmed, still try to generate report for today
        if (confirmResult.confirmed === 0) {
          const reportUseCase = this.#container.getGenerateDailyReport();
          return reportUseCase.execute({
            userId: chatId,
            conversationId,
            forceRegenerate: true,
          });
        }
        return confirmResult;
      }

      case 'review':
      case 'adjust': {
        const useCase = this.#container.getStartAdjustmentFlow();
        return useCase.execute({
          userId: chatId,
          conversationId,
        });
      }

      case 'coach': {
        const useCase = this.#container.getGenerateOnDemandCoaching();
        return useCase.execute({
          userId: chatId,
          conversationId,
        });
      }

      case 'confirm': {
        const useCase = this.#container.getConfirmAllPending();
        return useCase.execute({
          userId: chatId,
          conversationId,
        });
      }

      default:
        // Unknown command - treat as text
        return this.#handleText(chatId, command, messageId, {});
    }
  }

  // ==================== Helpers ====================

  /**
   * Get message type for logging
   * @private
   */
  #getMessageType(message) {
    if (message.photo) return 'photo';
    if (message.voice) return 'voice';
    if (message.text) return 'text';
    if (message.document) return 'document';
    if (message.sticker) return 'sticker';
    return 'unknown';
  }

  /**
   * Extract log UUID from message (if stored in message data)
   * @private
   */
  #extractLogUuidFromMessage(message) {
    // Try to extract from reply_markup or message text
    // This is a fallback - ideally UUID is in callback data
    return null;
  }
}

export default NutribotEventRouter;
