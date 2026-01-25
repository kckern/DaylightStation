/**
 * Journalist Input Router
 * @module journalist/adapters/JournalistInputRouter
 *
 * Routes platform-agnostic IInputEvents to Journalist use cases.
 */

import { HandleSpecialStart } from '../../3_applications/journalist/usecases/HandleSpecialStart.mjs';
import { InputEventType } from '../telegram/IInputEvent.mjs';

/**
 * Journalist Input Router
 * Routes IInputEvents to appropriate Journalist use cases
 */
export class JournalistInputRouter {
  #container;
  #logger;

  /**
   * @param {import('../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
   * @param {Object} [options]
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new Error('container is required');
    this.#container = container;
    this.#logger = options.logger || console;
  }

  /**
   * Route an IInputEvent to the appropriate use case
   * @param {import('../telegram/IInputEvent.mjs').IInputEvent} event
   * @returns {Promise<any>}
   */
  async route(event) {
    const { type, conversationId, messageId, payload, metadata } = event;

    this.#logger.debug?.('router.event', { type, conversationId, messageId });

    // Normalize IInputEvent payload to internal format expected by handlers
    const normalizedPayload = {
      ...payload,
      // Map IInputEvent.payload.callbackData to internal 'data' field
      data: payload.callbackData,
      // For commands, text contains args
      args: payload.text,
      // Source message ID for callback handlers
      sourceMessageId: messageId,
    };

    // Extract userId from metadata for enrichment
    const userId = metadata?.senderId;
    const enrichedMetadata = { ...metadata, userId };

    try {
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(conversationId, payload.text, messageId, enrichedMetadata);

        case InputEventType.VOICE:
          return this.#handleVoice(conversationId, normalizedPayload, messageId, enrichedMetadata);

        case InputEventType.COMMAND:
          return this.#handleCommand(conversationId, payload.command, payload.text, messageId, enrichedMetadata);

        case InputEventType.CALLBACK:
          return this.#handleCallback(conversationId, normalizedPayload, messageId, enrichedMetadata);

        default:
          this.#logger.warn?.('router.unknownEventType', { type });
          return null;
      }
    } catch (error) {
      this.#logger.error?.('router.error', {
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
  async #handleText(conversationId, text, messageId, metadata) {
    this.#logger.debug?.('router.text', { conversationId, textLength: text?.length });

    // Check for special starts (🎲, ❌)
    if (HandleSpecialStart.isSpecialStart(text)) {
      const useCase = this.#container.getHandleSpecialStart?.();
      if (useCase) {
        return useCase.execute({
          chatId: conversationId,
          messageId,
          text,
        });
      }
    }

    // Check for debrief response buttons (📊 Show Details, 💬 Ask Me, ✅ Accept)
    const debriefResponseHandler = this.#container.getHandleDebriefResponse?.();
    if (debriefResponseHandler && this.#isDebriefButton(text)) {
      const result = await debriefResponseHandler.execute({
        conversationId,
        text,
      });
      if (result?.handled) {
        return result;
      }
    }

    // Check for source picker buttons (🏋️ strava, ← Back, etc.)
    const sourceSelectionHandler = this.#container.getHandleSourceSelection?.();
    if (sourceSelectionHandler && this.#isSourcePickerButton(text)) {
      const result = await sourceSelectionHandler.execute({
        conversationId,
        text,
      });
      if (result?.handled) {
        return result;
      }
    }

    // Check if user is responding to morning debrief (category selection - legacy)
    const categoryHandler = this.#container.getHandleCategorySelection?.();
    if (categoryHandler) {
      const result = await categoryHandler.execute({
        conversationId,
        messageText: text,
      });

      // If it was handled as a category selection, we're done
      if (result && result.success && !result.freeform) {
        return result;
      }
    }

    // Regular text entry - route to ProcessTextEntry
    const useCase = this.#container.getProcessTextEntry();
    return useCase.execute({
      chatId: conversationId,
      text,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
    });
  }

  /**
   * Check if text is a main debrief button
   * @private
   */
  #isDebriefButton(text) {
    const debriefButtons = ['📊 Details', '💬 Ask', '✅ OK'];
    return debriefButtons.includes(text);
  }

  /**
   * Check if text is a source picker button
   * @private
   */
  #isSourcePickerButton(text) {
    // Back button
    if (text === '← Back') return true;

    // Source buttons: "🏋️ strava", "💻 github", etc.
    const sourceIcons = ['⌚', '🏋️', '🏃', '⚖️', '📆', '💻', '📍', '💬', '📄'];
    return sourceIcons.some((icon) => text.startsWith(icon + ' '));
  }

  /**
   * Handle voice input
   * @private
   */
  async #handleVoice(conversationId, payload, messageId, metadata) {
    this.#logger.debug?.('router.voice', { conversationId, hasFileId: !!payload.fileId });

    const useCase = this.#container.getProcessVoiceEntry();
    return useCase.execute({
      chatId: conversationId,
      voiceFileId: payload.fileId,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
    });
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(conversationId, command, args, messageId, metadata) {
    this.#logger.debug?.('router.command', { conversationId, command });

    // Delete the slash command message to keep chat clean
    try {
      const gateway = this.#container.getMessagingGateway?.();
      if (gateway && messageId) {
        await gateway.deleteMessage(conversationId, messageId);
      }
    } catch (e) {
      // Ignore delete errors (message may already be gone)
    }

    const useCase = this.#container.getHandleSlashCommand?.();
    if (useCase) {
      // Build full command string with leading slash
      const fullCommand = args ? `/${command} ${args}` : `/${command}`;
      return useCase.execute({
        chatId: conversationId,
        command: fullCommand,
        userId: metadata?.senderId,
      });
    }

    this.#logger.warn?.('router.command.noHandler', { command });
    return null;
  }

  /**
   * Handle callback (button press)
   * @private
   */
  async #handleCallback(conversationId, payload, messageId, metadata) {
    this.#logger.debug?.('router.callback', { conversationId, data: payload.data });

    // Handle debrief-specific callbacks
    if (payload.data?.startsWith('debrief:')) {
      return this.#handleDebriefCallback(conversationId, payload, messageId, metadata);
    }

    // Handle other callbacks (quiz, journal, etc.)
    const useCase = this.#container.getHandleCallbackResponse();
    return useCase.execute({
      chatId: conversationId,
      messageId: payload.sourceMessageId,
      callbackData: payload.data,
      options: {
        senderId: this.#extractSenderId(metadata),
        senderName: this.#extractSenderName(metadata),
        foreignKey: null,
      },
    });
  }

  /**
   * Handle debrief-specific callbacks
   * @private
   */
  async #handleDebriefCallback(conversationId, payload, messageId, metadata) {
    const action = payload.data.replace('debrief:', '');

    // Handle source selection (e.g., "source:events")
    if (action.startsWith('source:')) {
      const sourceName = action.replace('source:', '');

      // Get state to find the debrief date
      const stateStore = this.#container.getConversationStateStore();
      const state = await stateStore.get(conversationId);

      // Try to get debriefDate from state, or fall back to today's date
      let debriefDate = state?.debriefDate;

      if (!debriefDate) {
        // Fall back to most recent debrief
        const userResolver = this.#container.getUserResolver();
        const username = userResolver.resolveUsername(conversationId);
        const debriefRepo = this.#container.getDebriefRepository();
        const recentDebriefs = await debriefRepo.getRecentDebriefs(username, 1);

        if (!recentDebriefs || recentDebriefs.length === 0) {
          const gateway = this.#container.getMessagingGateway();
          await gateway.sendMessage(conversationId, '❌ No recent debrief found');
          return { success: false };
        }

        debriefDate = recentDebriefs[0].date;
      }

      // Get the debrief from the repository
      const debriefRepo = this.#container.getDebriefRepository();
      const debrief = await debriefRepo.getDebriefByDate(debriefDate);

      if (!debrief || !debrief.summaries) {
        const gateway = this.#container.getMessagingGateway();
        await gateway.sendMessage(conversationId, '❌ No debrief found for that date');
        return { success: false };
      }

      // Find the summary for this source
      const summary = debrief.summaries.find((s) => s.source === sourceName);

      if (!summary) {
        const gateway = this.#container.getMessagingGateway();
        await gateway.sendMessage(conversationId, `❌ No data found for source: ${sourceName}`);
        return { success: false };
      }

      // Send the detail text
      const gateway = this.#container.getMessagingGateway();
      await gateway.sendMessage(conversationId, summary.text);
      return { success: true };
    }

    switch (action) {
      case 'details': {
        // Show source picker
        const debriefResponseHandler = this.#container.getHandleDebriefResponse?.();
        if (debriefResponseHandler) {
          return debriefResponseHandler.execute({
            conversationId,
            text: '📊 Details',
            messageId: payload.sourceMessageId,
          });
        }
        break;
      }

      case 'ask': {
        // Start interview flow (generate questions on-demand)
        const stateStore = this.#container.getConversationStateStore();
        const state = await stateStore.get(conversationId);
        const debriefDate = state?.debriefDate;

        const interviewUseCase = this.#container.getInitiateDebriefInterview?.();
        if (interviewUseCase) {
          return interviewUseCase.execute({
            conversationId,
            debriefDate,
          });
        }

        // Fallback if not available
        const gateway = this.#container.getMessagingGateway();
        await gateway.sendMessage(conversationId, '❓ Interview flow not available');
        return { success: true };
      }

      case 'accept': {
        // Remove keyboard, acknowledge
        const msg = this.#container.getMessagingGateway();
        await msg.editMessageReplyMarkup(conversationId, payload.sourceMessageId, null);
        return { success: true };
      }

      case 'back': {
        // Go back to main debrief keyboard
        const backGateway = this.#container.getMessagingGateway();
        const debriefKeyboard = {
          inline_keyboard: [
            [
              { text: '📊 Details', callback_data: 'debrief:details' },
              { text: '💬 Ask', callback_data: 'debrief:ask' },
              { text: '✅ OK', callback_data: 'debrief:accept' },
            ],
          ],
        };
        await backGateway.updateKeyboard(
          conversationId,
          payload.sourceMessageId,
          debriefKeyboard.inline_keyboard,
        );
        return { success: true };
      }

      default:
        this.#logger.warn?.('router.debrief-callback.unknown', { action });
        return null;
    }
  }

  // ==================== Helpers ====================

  /**
   * Extract sender ID from metadata
   * @private
   */
  #extractSenderId(metadata) {
    return String(metadata?.senderId || metadata?.userId || metadata?.fromId || 'unknown');
  }

  /**
   * Extract sender name from metadata
   * @private
   */
  #extractSenderName(metadata) {
    return (
      metadata?.firstName ||
      metadata?.first_name ||
      metadata?.username ||
      metadata?.senderName ||
      'User'
    );
  }
}

export default JournalistInputRouter;
