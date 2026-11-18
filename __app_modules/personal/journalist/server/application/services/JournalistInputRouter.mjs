/**
 * Journalist Input Router
 * @module applications/journalist/services/JournalistInputRouter
 *
 * Routes platform-agnostic IInputEvents to Journalist use cases.
 */

import { InputEventType } from '#domains/messaging/index.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

// Special start characters (moved from HandleSpecialStart use case)
const SPECIAL_START_CHARS = ['🎲', '❌'];

/**
 * Journalist Input Router
 * Routes IInputEvents to appropriate Journalist use cases
 */
export class JournalistInputRouter {
  #container;
  #logger;
  #userResolver;
  #userIdentityService;
  #aiGatewayAvailable;
  #knowledgeCompanion;
  #workCompanion;

  /**
   * @param {import('../../3_applications/journalist/JournalistContainer.mjs').JournalistContainer} container
   * @param {Object} [options]
   * @param {{resolveUser: Function}} [options.userResolver] - Platform-identity resolution capability
   * @param {import('../../2_domains/messaging/services/UserIdentityService.mjs').UserIdentityService} [options.userIdentityService] - Domain identity service (preferred)
   * @param {Object} [options.logger]
   */
  constructor(container, options = {}) {
    if (!container) throw new ValidationError('container is required', {
      code: 'MISSING_CONFIG',
      field: 'container'
    });
    this.#container = container;
    this.#userIdentityService = options.userIdentityService || null;
    this.#userResolver = options.userResolver;
    this.#aiGatewayAvailable = options.aiGatewayAvailable !== false;
    this.#logger = options.logger || console;
    this.#knowledgeCompanion = options.knowledgeCompanion ?? null;
    this.#workCompanion = options.workCompanion ?? null;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(conversationId, context = {}) {
    if (context.responseContext) {
      return context.responseContext;
    }
    // Fallback to container gateway with conversationId
    const gateway = this.#container.getMessagingGateway?.();
    return {
      sendMessage: (text, options) => gateway?.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => gateway?.updateMessage(conversationId, msgId, updates),
      updateKeyboard: (msgId, choices) => gateway?.updateKeyboard(conversationId, msgId, choices),
      editMessageReplyMarkup: (msgId, markup) => gateway?.editMessageReplyMarkup(conversationId, msgId, markup),
      deleteMessage: msgId => gateway?.deleteMessage(conversationId, msgId)
    };
  }

  /**
   * Route an IInputEvent to the appropriate use case
   * @param {import('../telegram/IInputEvent.mjs').IInputEvent} event
   * @param {import('#apps/common/ports/IResponseContext.mjs').IResponseContext} [responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<any>}
   */
  async route(event, responseContext = null, requestContext = {}) {
    const {
      type,
      conversationId,
      messageId,
      payload,
      metadata
    } = event;
    const context = Object.freeze({
      responseContext,
      userId: this.#resolveUserId(event),
      knowledgePrincipal: requestContext.knowledgePrincipal ?? null,
      workPrincipal: requestContext.workPrincipal ?? null
    });
    this.#logger.debug?.('router.event', {
      type,
      conversationId,
      messageId
    });

    // Normalize IInputEvent payload to internal format expected by handlers
    const normalizedPayload = {
      ...payload,
      // Map IInputEvent.payload.callbackData to internal 'data' field
      data: payload.callbackData,
      // For commands, text contains args
      args: payload.text,
      // Source message ID for callback handlers
      sourceMessageId: messageId
    };

    // Extract userId from metadata for enrichment
    const userId = metadata?.senderId;
    const enrichedMetadata = {
      ...metadata,
      userId
    };
    try {
      if (metadata?.edited && type === InputEventType.TEXT) return this.#processText(conversationId, payload.text, messageId, enrichedMetadata, context);
      switch (type) {
        case InputEventType.TEXT:
          return this.#handleText(conversationId, payload.text, messageId, enrichedMetadata, context);
        case InputEventType.VOICE:
          return this.#handleVoice(conversationId, normalizedPayload, messageId, enrichedMetadata, context);
        case InputEventType.COMMAND:
          return this.#handleCommand(conversationId, payload.command, payload.text, messageId, enrichedMetadata, context);
        case InputEventType.CALLBACK:
          return this.#handleCallback(conversationId, normalizedPayload, messageId, enrichedMetadata, context);
        default:
          this.#logger.warn?.('router.unknownEventType', {
            type
          });
          return null;
      }
    } catch (error) {
      this.#logger.error?.('router.error', {
        type,
        conversationId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // ==================== Input Handlers ====================

  /**
   * Handle text input
   * @private
   */
  async #handleText(conversationId, text, messageId, metadata, context) {
    this.#logger.debug?.('router.text', {
      conversationId,
      textLength: text?.length
    });
    const workFlows = {
      'Work': 'tasks',
      'My tasks': 'tasks',
      'To-dos': 'tasks',
      'Complete task': 'tasks',
      'Projects': 'projects',
      'Project work': 'projects',
      'Create task': 'create_task',
      'Create project': 'create_container',
      'Link work': 'create_link',
      'Review work': 'housekeeping',
      'Review suggestions': 'knowledge_review'
    };
    if (this.#workCompanion && context.workPrincipal && Object.hasOwn(workFlows, text)) return this.#workCompanion.open({
      principal: context.workPrincipal,
      knowledgePrincipal: context.knowledgePrincipal,
      flow: workFlows[text],
      responseContext: context.responseContext
    });
    // Check for special starts (🎲, ❌)
    if (this.#isSpecialStart(text)) {
      // 🎲 starts a new AI-generated prompt; ❌ only clears state and remains
      // available while the model is offline.
      if (!this.#aiGatewayAvailable && (text.includes('🎲') || text.toLowerCase().includes('change'))) {
        return this.#unavailable(conversationId, 'special-start', context);
      }
      const useCase = this.#container.getHandleSpecialStart?.();
      if (useCase) {
        return useCase.execute({
          chatId: conversationId,
          userId: context.userId,
          messageId,
          text,
          responseContext: context.responseContext
        });
      }
    }

    // Check for debrief response buttons (📊 Show Details, 💬 Ask Me, ✅ Accept)
    const debriefResponseHandler = this.#container.getHandleDebriefResponse?.();
    if (debriefResponseHandler && this.#isDebriefButton(text)) {
      const result = await debriefResponseHandler.execute({
        conversationId,
        userId: context.userId,
        text,
        responseContext: context.responseContext
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
        userId: context.userId,
        text,
        responseContext: context.responseContext
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
        userId: context.userId,
        messageText: text,
        responseContext: context.responseContext
      });

      // If it was handled as a category selection, we're done
      if (result && result.success && !result.freeform) {
        return result;
      }
    }
    return this.#processText(conversationId, text, messageId, metadata, context);
  }
  async #processText(conversationId, text, messageId, metadata, context) {
    // Regular text entry - route to ProcessTextEntry
    if (!this.#aiGatewayAvailable && !context.knowledgePrincipal && !context.workPrincipal && !metadata?.edited) return this.#unavailable(conversationId, 'text', context);
    const useCase = this.#container.getProcessTextEntry();
    return useCase.execute({
      chatId: conversationId,
      userId: context.userId,
      text,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
      journalEdit: metadata?.edited && metadata.chatType === 'private' && String(metadata.chatId) === this.#extractSenderId(metadata) ? {
        edited: true,
        editDate: metadata.editDate,
        updateId: metadata.updateId
      } : undefined,
      knowledgePrincipal: context.knowledgePrincipal,
      workPrincipal: context.workPrincipal,
      aiAvailable: this.#aiGatewayAvailable,
      responseContext: context.responseContext
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
    return sourceIcons.some(icon => text.startsWith(icon + ' '));
  }

  /**
   * Check if text is a special start character (routing decision)
   * @private
   */
  #isSpecialStart(text) {
    if (!text) return false;
    return SPECIAL_START_CHARS.some(char => text.startsWith(char));
  }

  /**
   * Handle voice input
   * @private
   */
  async #handleVoice(conversationId, payload, messageId, metadata, context) {
    this.#logger.debug?.('router.voice', {
      conversationId,
      hasFileId: !!payload.fileId
    });
    if (!this.#aiGatewayAvailable) return this.#unavailable(conversationId, 'voice', context);
    const useCase = this.#container.getProcessVoiceEntry();
    return useCase.execute({
      chatId: conversationId,
      userId: context.userId,
      voiceFileId: payload.fileId,
      messageId,
      senderId: this.#extractSenderId(metadata),
      senderName: this.#extractSenderName(metadata),
      knowledgePrincipal: context.knowledgePrincipal,
      workPrincipal: context.workPrincipal,
      aiAvailable: this.#aiGatewayAvailable,
      responseContext: context.responseContext
    });
  }

  /**
   * Handle slash command
   * @private
   */
  async #handleCommand(conversationId, command, args, messageId, metadata, context) {
    const workFlows = {
      work: 'tasks',
      todos: 'tasks',
      projects: 'projects',
      link_work: 'create_link',
      work_review: 'housekeeping',
      suggestions: 'knowledge_review'
    };
    if (this.#workCompanion && context.workPrincipal && Object.hasOwn(workFlows, command)) return this.#workCompanion.open({
      principal: context.workPrincipal,
      knowledgePrincipal: context.knowledgePrincipal,
      flow: workFlows[command],
      responseContext: context.responseContext
    });
    this.#logger.debug?.('router.command', {
      conversationId,
      command
    });

    // Delete the slash command message to keep chat clean
    try {
      const messaging = this.#getMessaging(conversationId, context);
      if (messageId) {
        await messaging.deleteMessage(messageId);
      }
    } catch (e) {
      // Ignore delete errors (message may already be gone)
    }
    const aiCommands = new Set(['prompt', 'start', 'yesterday', 'counsel', 'therapist', 'analyze']);
    if (!this.#aiGatewayAvailable && aiCommands.has(String(command || '').toLowerCase())) {
      return this.#unavailable(conversationId, 'command', context);
    }
    const useCase = this.#container.getHandleSlashCommand?.();
    if (useCase) {
      // Build full command string with leading slash
      const fullCommand = args ? `/${command} ${args}` : `/${command}`;
      return useCase.execute({
        chatId: conversationId,
        command: fullCommand,
        userId: context.userId,
        responseContext: context.responseContext
      });
    }
    this.#logger.warn?.('router.command.noHandler', {
      command
    });
    return null;
  }

  /**
   * Handle callback (button press)
   * @private
   */
  async #handleCallback(conversationId, payload, messageId, metadata, context) {
    this.#logger.debug?.('router.callback', {
      conversationId,
      kind: payload.data?.startsWith('w1:') ? 'work' : payload.data?.startsWith('kb1:') ? 'knowledge' : 'legacy'
    });
    if (payload.data?.startsWith('w1:')) {
      try {
        return (await this.#workCompanion?.handleCallback({
          principal: context.workPrincipal,
          knowledgePrincipal: context.knowledgePrincipal,
          callbackData: payload.data,
          conversationId,
          botMessageId: messageId,
          responseContext: context.responseContext
        })) ?? {
          handled: true,
          status: 'denied'
        };
      } catch {
        this.#logger.warn?.('journalist.work.callback-unavailable');
        return {
          handled: true,
          status: 'uncertain'
        };
      }
    }
    if (payload.data?.startsWith('kb1:') || payload.data === 'debrief:ask' || ['journal:change', 'journal:skip', 'journal:done'].includes(payload.data)) {
      const result = await this.#knowledgeCompanion?.handleCallback({
        principal: context.knowledgePrincipal,
        callbackData: payload.data,
        conversationId,
        botMessageId: messageId,
        responseContext: context.responseContext
      });
      if (result?.handled) return result;
      if (payload.data?.startsWith('kb1:')) return {
        handled: true,
        status: 'rejected'
      };
    }

    // Handle debrief-specific callbacks
    if (payload.data?.startsWith('debrief:')) {
      return this.#handleDebriefCallback(conversationId, payload, messageId, metadata, context);
    }

    // Handle other callbacks (quiz, journal, etc.)
    const useCase = this.#container.getHandleCallbackResponse();
    return useCase.execute({
      chatId: conversationId,
      userId: context.userId,
      messageId: payload.sourceMessageId,
      callbackData: payload.data,
      options: {
        senderId: this.#extractSenderId(metadata),
        senderName: this.#extractSenderName(metadata),
        foreignKey: null
      },
      responseContext: context.responseContext
    });
  }

  /**
   * Handle debrief-specific callbacks
   * @private
   */
  async #handleDebriefCallback(conversationId, payload, messageId, metadata, context) {
    const action = payload.data.replace('debrief:', '');
    const messaging = this.#getMessaging(conversationId, context);

    // Handle source selection (e.g., "source:events")
    if (action.startsWith('source:')) {
      const sourceName = action.replace('source:', '');
      const userId = context.userId;

      // Get state to find the debrief date
      const stateStore = this.#container.getConversationStateStore();
      const state = await stateStore.get(conversationId);

      // Try to get debriefDate from state, or fall back to today's date
      let debriefDate = state?.debriefDate;
      if (!debriefDate) {
        // Fall back to most recent debrief
        if (!userId) {
          await messaging.sendMessage('❌ Could not identify user');
          return {
            handled: true,
            outcome: 'rejected'
          };
        }
        const debriefRepo = this.#container.getDebriefRepository();
        const recentDebriefs = await debriefRepo.getRecentDebriefs(userId, 1);
        if (!recentDebriefs || recentDebriefs.length === 0) {
          await messaging.sendMessage('❌ No recent debrief found');
          return {
            handled: true,
            outcome: 'rejected'
          };
        }
        debriefDate = recentDebriefs[0].date;
      }

      // Get the debrief from the repository
      const debriefRepo = this.#container.getDebriefRepository();
      const debrief = await debriefRepo.getDebriefByDate(debriefDate, userId);
      if (!debrief || !debrief.summaries) {
        await messaging.sendMessage('❌ No debrief found for that date');
        return {
          handled: true,
          outcome: 'rejected'
        };
      }

      // Find the summary for this source
      const summary = debrief.summaries.find(s => s.source === sourceName);
      if (!summary) {
        await messaging.sendMessage(`❌ No data found for source: ${sourceName}`);
        return {
          handled: true,
          outcome: 'rejected'
        };
      }

      // Send the detail text
      await messaging.sendMessage(summary.text);
      return {
        success: true
      };
    }
    switch (action) {
      case 'details':
        {
          // Show source picker
          const debriefResponseHandler = this.#container.getHandleDebriefResponse?.();
          if (debriefResponseHandler) {
            return debriefResponseHandler.execute({
              conversationId,
              userId: context.userId,
              text: '📊 Details',
              messageId: payload.sourceMessageId,
              responseContext: context.responseContext
            });
          }
          break;
        }
      case 'ask':
        {
          if (!this.#aiGatewayAvailable) return this.#unavailable(conversationId, 'debrief', context);
          // Start interview flow (generate questions on-demand)
          const stateStore = this.#container.getConversationStateStore();
          const state = await stateStore.get(conversationId);
          const debriefDate = state?.debriefDate;
          const interviewUseCase = this.#container.getInitiateDebriefInterview?.();
          if (interviewUseCase) {
            return interviewUseCase.execute({
              conversationId,
              userId: context.userId,
              debriefDate,
              responseContext: context.responseContext
            });
          }

          // Fallback if not available
          await messaging.sendMessage('❓ Interview flow not available');
          return {
            success: true
          };
        }
      case 'accept':
        {
          // Remove keyboard, acknowledge
          await messaging.editMessageReplyMarkup(payload.sourceMessageId, null);
          return {
            success: true
          };
        }
      case 'back':
        {
          // Go back to main debrief keyboard
          const debriefKeyboard = {
            inline_keyboard: [[{
              text: '📊 Details',
              callback_data: 'debrief:details'
            }, {
              text: '💬 Ask',
              callback_data: 'debrief:ask'
            }, {
              text: '✅ OK',
              callback_data: 'debrief:accept'
            }]]
          };
          await messaging.updateKeyboard(payload.sourceMessageId, debriefKeyboard.inline_keyboard);
          return {
            success: true
          };
        }
      default:
        this.#logger.warn?.('router.debrief-callback.unknown', {
          action
        });
        return null;
    }
  }

  // ==================== Helpers ====================

  async #unavailable(conversationId, type, context) {
    const message = 'Journal prompts and analysis are temporarily unavailable. Please try again shortly.';
    this.#logger.warn?.('journalist.ai.unavailable', {
      conversationId,
      type
    });
    await this.#getMessaging(conversationId, context).sendMessage(message, {});
    return {
      ok: false,
      code: 'AI_UNAVAILABLE',
      error: message
    };
  }

  /**
   * Resolve user ID from platform identity using UserResolver
   * Falls back to conversationId if resolution fails
   * @private
   * @returns {string|null}
   */
  #resolveUserId(event) {
    // Prefer domain identity service
    if (this.#userIdentityService && event?.platform && event?.platformUserId) {
      const username = this.#userIdentityService.resolveUsername(event.platform, event.platformUserId);
      if (username) {
        this.#logger.debug?.('journalist.resolveUserId.resolved', {
          username,
          platformUserId: event.platformUserId
        });
        return username;
      }
      this.#logger.warn?.('journalist.identity.notFound', {
        platform: event.platform,
        platformUserId: event.platformUserId
      });
    }

    // Fallback to legacy UserResolver
    if (this.#userResolver && event?.platform && event?.platformUserId) {
      const username = this.#userResolver.resolveUser(event.platform, event.platformUserId);
      if (username) return username;
    }

    // Fallback to conversationId for backwards compatibility
    return event?.conversationId || null;
  }

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
    return metadata?.firstName || metadata?.first_name || metadata?.username || metadata?.senderName || 'User';
  }
}
export default JournalistInputRouter;
