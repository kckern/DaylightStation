// backend/src/3_applications/nutribot/handlers/WebhookHandler.mjs
import { decodeCallback, CallbackActions } from '../lib/callback.mjs';

/**
 * Routes normalized webhook input to appropriate use cases
 */
export class WebhookHandler {
  #container;
  #config;
  #logger;

  constructor(config) {
    if (!config.container) {
      throw new Error('WebhookHandler requires container');
    }
    this.#container = config.container;
    this.#config = config.nutribotConfig;
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
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      text: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleImage(input) {
    const useCase = this.#container.getLogFoodFromImage();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      fileId: input.fileId,
      caption: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleVoice(input) {
    const useCase = this.#container.getLogFoodFromVoice();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      fileId: input.fileId,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleUPC(input) {
    const useCase = this.#container.getLogFoodFromUPC();
    const result = await useCase.execute({
      userId: this.#resolveUserId(input.userId),
      conversationId: input.userId,
      barcode: input.text,
      messageId: input.messageId
    });
    return { ok: true, result };
  }

  async #handleCallback(input) {
    const decoded = decodeCallback(input.callbackData);
    const action = decoded.a;

    // Acknowledge callback immediately
    const messaging = this.#container.getMessagingGateway();
    await messaging.answerCallback(input.callbackId);

    switch (action) {
      case CallbackActions.ACCEPT_LOG: {
        const useCase = this.#container.getAcceptFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REJECT_LOG: {
        const useCase = this.#container.getDiscardFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.id,
          messageId: input.messageId
        });
      }
      case CallbackActions.REVISE_ITEM: {
        const useCase = this.#container.getReviseFoodLog();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          logId: decoded.logId,
          itemId: decoded.itemId,
          messageId: input.messageId
        });
      }
      default:
        this.#logger.warn?.('webhook.callback.unknown', { action });
        return { ok: true, handled: false };
    }
  }

  async #handleCommand(input) {
    switch (input.command) {
      case 'help': {
        const useCase = this.#container.getHandleHelpCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      case 'review': {
        const useCase = this.#container.getHandleReviewCommand();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      case 'report': {
        const useCase = this.#container.getGenerateDailyReport();
        return await useCase.execute({
          userId: this.#resolveUserId(input.userId),
          conversationId: input.userId
        });
      }
      default:
        this.#logger.warn?.('webhook.command.unknown', { command: input.command });
        return { ok: true, handled: false };
    }
  }

  #resolveUserId(conversationId) {
    if (this.#config?.getUserIdFromConversation) {
      return this.#config.getUserIdFromConversation(conversationId) || conversationId;
    }
    return conversationId;
  }
}
