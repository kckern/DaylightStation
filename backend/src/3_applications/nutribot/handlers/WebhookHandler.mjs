// backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs
/**
 * @deprecated Use NutribotInputRouter from 2_adapters/nutribot instead.
 * This handler is legacy and does not use the centralized UserResolver for identity resolution.
 * It expects userId to already be a resolved system username.
 */
import { decodeCallback, CallbackActions } from '../lib/callback.mjs';

/**
 * Routes normalized webhook input to appropriate use cases
 *
 * @deprecated Use NutribotInputRouter from 2_adapters/nutribot instead.
 * This handler expects pre-resolved usernames, not conversation IDs.
 */
export class WebhookHandler {
  #container;
  #logger;

  constructor(config) {
    if (!config.container) {
      throw new Error('WebhookHandler requires container');
    }
    this.#container = config.container;
    this.#logger = config.logger || console;
  }

  async handle(input) {
    this.#logger.debug?.('webhook.received', {
      type: input.type,
      userId: input.userId
    });

    try {
      switch (input.type) {
        case 'text':
          return await this.#handleText(input);
        case 'image':
          return await this.#handleImage(input);
        case 'voice':
          return await this.#handleVoice(input);
        case 'upc':
          return await this.#handleUPC(input);
        case 'callback':
          return await this.#handleCallback(input);
        case 'command':
          return await this.#handleCommand(input);
        default:
          this.#logger.warn?.('webhook.unsupported', { type: input.type });
          return { ok: true, handled: false };
      }
    } catch (error) {
      this.#logger.error?.('webhook.error', {
        type: input.type,
        error: error.message
      });
      throw error;
    }
  }

  async #handleText(input) {
    const useCase = this.#container.getLogFoodFromText();
    const result = await useCase.execute({
      userId: input.userId,
      conversationId: input.conversationId || input.userId,
      text: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleImage(input) {
    const useCase = this.#container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId: input.userId,
      conversationId: input.conversationId || input.userId,
      fileId: input.fileId,
      caption: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleVoice(input) {
    const useCase = this.#container.getLogFoodFromVoice();
    const result = await useCase.execute({
      userId: input.userId,
      conversationId: input.conversationId || input.userId,
      voiceData: { fileId: input.fileId },
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleUPC(input) {
    const useCase = this.#container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId: input.userId,
      conversationId: input.conversationId || input.userId,
      barcode: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleCallback(input) {
    const decoded = decodeCallback(input.callbackData);

    // Support both new format (a key) and legacy format (cmd key with short codes)
    let action = decoded.a || decoded.cmd;

    // Map legacy short codes to action constants
    const legacyActionMap = {
      'a': CallbackActions.ACCEPT_LOG,
      'r': CallbackActions.REVISE_ITEM,
      'x': CallbackActions.REJECT_LOG,
    };
    if (legacyActionMap[action]) {
      action = legacyActionMap[action];
    }

    // Acknowledge callback immediately
    const messaging = this.#container.getMessagingGateway();
    await messaging.answerCallback(input.callbackId);

    switch (action) {
      case CallbackActions.ACCEPT_LOG: {
        const useCase = this.#container.getAcceptFoodLog();
        return await useCase.execute({
          userId: input.userId,
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REJECT_LOG: {
        const useCase = this.#container.getDiscardFoodLog();
        return await useCase.execute({
          userId: input.userId,
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REVISE_ITEM: {
        const useCase = this.#container.getReviseFoodLog();
        return await useCase.execute({
          userId: input.userId,
          logId: decoded.logId || decoded.id,
          itemId: decoded.itemId,
          messageId: input.messageId
        });
      }
      default:
        this.#logger.warn?.('webhook.callback.unknown', { action, decoded });
        return { ok: true, handled: false };
    }
  }

  async #handleCommand(input) {
    switch (input.command) {
      case 'help': {
        const useCase = this.#container.getHandleHelpCommand();
        return await useCase.execute({
          userId: input.userId,
          conversationId: input.conversationId || input.userId
        });
      }
      case 'review': {
        const useCase = this.#container.getHandleReviewCommand();
        return await useCase.execute({
          userId: input.userId,
          conversationId: input.conversationId || input.userId
        });
      }
      case 'report': {
        const useCase = this.#container.getGenerateDailyReport();
        return await useCase.execute({
          userId: input.userId,
          conversationId: input.conversationId || input.userId,
          autoAcceptPending: true,
        });
      }
      default:
        this.#logger.warn?.('webhook.command.unknown', { command: input.command });
        return { ok: true, handled: false };
    }
  }
}
