// backend/src/2_adapters/telegram/TelegramResponseContext.mjs

import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * TelegramResponseContext - Implements IResponseContext for Telegram
 *
 * Wraps a TelegramAdapter and captures the TelegramChatRef at creation time.
 * All messaging operations are bound to this specific chat, eliminating
 * the need for string parsing at send-time.
 *
 * This is the DDD-compliant way to handle platform identity:
 * - Created per-request in the adapter layer (where platform knowledge lives)
 * - Passed to use cases as IResponseContext (platform-agnostic interface)
 * - No conversationId string parsing needed at send-time
 */
export class TelegramResponseContext {
  /** @type {import('./TelegramAdapter.mjs').TelegramAdapter} */
  #adapter;

  /** @type {import('./TelegramChatRef.mjs').TelegramChatRef} */
  #chatRef;

  /** @type {string} */
  #chatId;

  /**
   * @param {Object} adapter - TelegramAdapter instance
   * @param {import('./TelegramChatRef.mjs').TelegramChatRef} chatRef - The chat this context is bound to
   */
  constructor(adapter, chatRef) {
    if (!adapter) {
      throw new InfrastructureError('TelegramResponseContext requires adapter', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'adapter'
      });
    }
    if (!chatRef) {
      throw new InfrastructureError('TelegramResponseContext requires chatRef', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'chatRef'
      });
    }

    this.#adapter = adapter;
    this.#chatRef = chatRef;
    this.#chatId = chatRef.chatId;

    Object.freeze(this);
  }

  /**
   * Get the bound chat reference (for logging/debugging)
   * @returns {import('./TelegramChatRef.mjs').TelegramChatRef}
   */
  get chatRef() {
    return this.#chatRef;
  }

  // ============ IResponseContext Implementation ============

  /**
   * Send a text message to the bound chat
   * @param {string} text
   * @param {Object} [options]
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendMessage(text, options = {}) {
    return this.#adapter.sendMessage(this.#chatId, text, options);
  }

  /**
   * Send a photo to the bound chat
   * @param {string} imageSource - File ID or URL
   * @param {string} [caption]
   * @param {Object} [options]
   * @returns {Promise<{messageId: string, ok: boolean}>}
   */
  async sendPhoto(imageSource, caption = '', options = {}) {
    return this.#adapter.sendImage(this.#chatId, imageSource, caption, options);
  }

  /**
   * Update an existing message
   * @param {string} messageId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async updateMessage(messageId, updates) {
    return this.#adapter.updateMessage(this.#chatId, messageId, updates);
  }

  /**
   * Update keyboard on an existing message
   * @param {string} messageId
   * @param {Array} choices
   * @returns {Promise<void>}
   */
  async updateKeyboard(messageId, choices) {
    return this.#adapter.updateKeyboard(this.#chatId, messageId, choices);
  }

  /**
   * Delete a message
   * @param {string} messageId
   * @returns {Promise<void>}
   */
  async deleteMessage(messageId) {
    return this.#adapter.deleteMessage(this.#chatId, messageId);
  }

  /**
   * Create a status indicator for a long-running operation.
   * Shows initial text immediately, optionally animates while waiting.
   * Telegram supports message updates, so finish() updates in place.
   *
   * @param {string} initialText - Initial status text (e.g., "🔍 Analyzing")
   * @param {Object} [options] - Options
   * @param {string[]} [options.frames] - Animation frames to cycle (e.g., ['.', '..', '...'])
   * @param {number} [options.interval=2000] - Animation interval in ms
   * @returns {Promise<IStatusIndicator>}
   */
  async createStatusIndicator(initialText, options = {}) {
    const { frames = null, interval = 2000 } = options;
    const shouldAnimate = Array.isArray(frames) && frames.length > 0;

    // Send initial status message (with first frame if animating)
    const initialDisplay = shouldAnimate ? `${initialText}${frames[0]}` : initialText;
    const { messageId } = await this.sendMessage(initialDisplay, {});

    let animationTimer = null;
    let currentFrame = 0;
    const baseText = initialText;

    // Start animation if frames provided
    if (shouldAnimate) {
      animationTimer = setInterval(async () => {
        currentFrame = (currentFrame + 1) % frames.length;
        try {
          await this.updateMessage(messageId, {
            text: `${baseText}${frames[currentFrame]}`,
          });
        } catch (e) {
          // Ignore update failures during animation (message may be gone)
        }
      }, interval);
    }

    const cleanup = () => {
      if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
      }
    };

    // Capture `this` for use in returned object methods
    const ctx = this;

    return {
      messageId,

      /**
       * Complete the status with final content.
       * Updates the message in place (Telegram supports this).
       * @param {string} content - Final message content
       * @param {Object} [options] - Options (choices, inline, parseMode)
       * @returns {Promise<string>} The message ID
       */
      async finish(content, options = {}) {
        cleanup();
        await ctx.updateMessage(messageId, {
          text: content,
          ...options,
        });
        return messageId;
      },

      /**
       * Cancel the status indicator without sending final content.
       * Deletes the status message.
       * @returns {Promise<void>}
       */
      async cancel() {
        cleanup();
        try {
          await ctx.deleteMessage(messageId);
        } catch (e) {
          // Ignore - message may already be gone
        }
      },
    };
  }

  /**
   * Create a photo-based status indicator with animated caption.
   * Sends photo immediately, then cycles caption frames via editMessageCaption.
   *
   * @param {Buffer|string} imageSource - Photo buffer, URL, or file ID
   * @param {string} initialCaption - Initial caption text
   * @param {Object} [options] - Options
   * @param {string[]} [options.frames] - Animation frames to append to caption
   * @param {number} [options.interval=2000] - Animation interval in ms
   * @returns {Promise<IStatusIndicator>}
   */
  async createPhotoStatusIndicator(imageSource, initialCaption, options = {}) {
    const { frames = null, interval = 2000 } = options;
    const shouldAnimate = Array.isArray(frames) && frames.length > 0;

    // Send photo with initial caption
    const initialDisplay = shouldAnimate ? `${initialCaption}${frames[0]}` : initialCaption;
    const { messageId } = await this.sendPhoto(imageSource, initialDisplay, {});

    let animationTimer = null;
    let currentFrame = 0;
    const baseCaption = initialCaption;

    // Start caption animation if frames provided
    if (shouldAnimate) {
      animationTimer = setInterval(async () => {
        currentFrame = (currentFrame + 1) % frames.length;
        try {
          await this.updateMessage(messageId, {
            caption: `${baseCaption}${frames[currentFrame]}`,
          });
        } catch (e) {
          // Ignore update failures during animation (message may be gone)
        }
      }, interval);
    }

    const cleanup = () => {
      if (animationTimer) {
        clearInterval(animationTimer);
        animationTimer = null;
      }
    };

    const ctx = this;

    return {
      messageId,

      async finish(content, options = {}) {
        cleanup();
        await ctx.updateMessage(messageId, {
          caption: content,
          ...options,
        });
        return messageId;
      },

      async cancel() {
        cleanup();
        try {
          await ctx.deleteMessage(messageId);
        } catch (e) {
          // Ignore - message may already be gone
        }
      },
    };
  }

  // ============ Additional Methods (Telegram-specific but useful) ============

  /**
   * Get file URL (for voice/image processing)
   * This delegates to adapter without needing chatId
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getFileUrl(fileId) {
    return this.#adapter.getFileUrl(fileId);
  }

  /**
   * Transcribe voice message
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async transcribeVoice(fileId) {
    return this.#adapter.transcribeVoice(fileId);
  }
}

export default TelegramResponseContext;
