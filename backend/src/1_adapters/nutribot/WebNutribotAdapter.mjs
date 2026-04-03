/**
 * WebNutribotAdapter - Adapts HTTP requests to the NutribotInputRouter interface.
 *
 * Replaces Telegram as the transport. Instead of sending responses back via
 * a messaging gateway, it captures them and returns as JSON.
 *
 * The capture context mirrors the IResponseContext interface used by
 * TelegramResponseContext — specifically the methods that use cases call:
 *   - sendMessage(text, options)    → returns { messageId }
 *   - updateMessage(id, updates)    → returns Promise
 *   - deleteMessage(id)             → returns Promise
 *   - createStatusIndicator(text)   → returns { messageId, finish(), cancel() }
 */

export class WebNutribotAdapter {
  #inputRouter;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.inputRouter - NutribotInputRouter instance
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.inputRouter) throw new Error('WebNutribotAdapter requires inputRouter');
    this.#inputRouter = config.inputRouter;
    this.#logger = config.logger || null;
  }

  #getLogger() {
    return this.#logger || console;
  }

  /**
   * Process a nutrition input from the web UI.
   *
   * @param {Object} input
   * @param {string} input.type - "text" | "voice" | "image" | "barcode"
   * @param {string} [input.content] - Text content or barcode/UPC string
   * @param {Buffer} [input.buffer] - Audio or image binary (for voice/image types)
   * @param {string} input.userId - Username
   * @returns {Promise<Object>} Captured response from the bot pipeline
   */
  async process(input) {
    const { type, content, buffer, userId } = input;
    const conversationId = `web:${userId}`;

    const event = {
      conversationId,
      userId,
      platform: 'web',
      platformUserId: userId,
      messageId: null,
      payload: {},
    };

    // Map input type to router event type and payload shape
    let routerType = type;
    switch (type) {
      case 'text':
        event.payload.text = content;
        break;
      case 'barcode':
        // handleUpc expects event.payload.text to be the UPC string
        event.payload.text = content;
        routerType = 'upc';
        break;
      case 'voice':
        // handleVoice expects event.payload.fileId (or audioBuffer for web)
        event.payload.fileId = null;
        event.payload.audioBuffer = buffer;
        break;
      case 'image':
        // handleImage expects event.payload.fileId (or imageBuffer for web)
        event.payload.fileId = null;
        event.payload.imageBuffer = buffer;
        event.payload.text = content || null; // optional caption
        break;
      default:
        throw new Error(`Unsupported input type: ${type}`);
    }

    // Create a capture context that collects the bot's responses
    const captured = { messages: [], photos: [], logged: false, nutrilogUuid: null };
    const responseContext = this.#createCaptureContext(captured);

    this.#getLogger().debug?.('web-nutribot.process', { type, userId, conversationId });

    try {
      switch (routerType) {
        case 'text':
          await this.#inputRouter.handleText(event, responseContext);
          break;
        case 'voice':
          await this.#inputRouter.handleVoice(event, responseContext);
          break;
        case 'image':
          await this.#inputRouter.handleImage(event, responseContext);
          break;
        case 'upc':
          await this.#inputRouter.handleUpc(event, responseContext);
          break;
      }
    } catch (err) {
      this.#getLogger().error?.('web-nutribot.error', { type, userId, error: err.message });
      throw err;
    }

    // Extract final text from last captured message for convenience
    const lastMessage = captured.messages[captured.messages.length - 1];
    const responseText = lastMessage?.text || null;

    return {
      messages: captured.messages,
      photos: captured.photos,
      logged: captured.logged,
      responseText,
    };
  }

  /**
   * Create a mock response context that captures bot output.
   * Mirrors the IResponseContext interface (TelegramResponseContext shape).
   *
   * Key methods called by use cases:
   *   - sendMessage(text, options)
   *   - updateMessage(messageId, updates)
   *   - deleteMessage(messageId)
   *   - createStatusIndicator(initialText, options)
   *   - sendPhoto(imageSource, caption, options)
   *
   * @private
   */
  #createCaptureContext(captured) {
    let nextId = 1;
    const makeId = () => `web_msg_${nextId++}`;

    // Track messages by ID so updates are reflected
    const messageStore = new Map();

    const sendMessage = (text, options = {}) => {
      const messageId = makeId();
      const entry = { messageId, text, options };
      messageStore.set(messageId, entry);
      captured.messages.push(entry);
      return Promise.resolve({ messageId, ok: true });
    };

    const updateMessage = (messageId, updates = {}) => {
      const existing = messageStore.get(String(messageId));
      if (existing) {
        // Merge updates into the tracked message
        if (updates.text !== undefined) existing.text = updates.text;
        if (updates.caption !== undefined) existing.text = updates.caption;
        if (updates.choices !== undefined) existing.choices = updates.choices;
        Object.assign(existing, updates);
      }
      return Promise.resolve();
    };

    const deleteMessage = (messageId) => {
      messageStore.delete(String(messageId));
      // Remove from captured messages list
      const idx = captured.messages.findIndex(m => m.messageId === String(messageId));
      if (idx >= 0) captured.messages.splice(idx, 1);
      return Promise.resolve();
    };

    const sendPhoto = (imageSource, caption = '', options = {}) => {
      const messageId = makeId();
      const entry = { messageId, type: 'photo', imageSource, caption, options };
      messageStore.set(messageId, entry);
      captured.photos.push(entry);
      return Promise.resolve({ messageId, ok: true });
    };

    const createStatusIndicator = async (initialText, options = {}) => {
      const { messageId } = await sendMessage(initialText, {});

      return {
        messageId,

        async finish(content, finishOptions = {}) {
          await updateMessage(messageId, { text: content, ...finishOptions });
          return messageId;
        },

        async cancel() {
          await deleteMessage(messageId);
        },
      };
    };

    // updateKeyboard is a subset of updateMessage — used in some callbacks
    const updateKeyboard = (messageId, choices) => {
      return updateMessage(messageId, { choices });
    };

    return {
      sendMessage,
      updateMessage,
      deleteMessage,
      sendPhoto,
      createStatusIndicator,
      updateKeyboard,
    };
  }
}

export default WebNutribotAdapter;
