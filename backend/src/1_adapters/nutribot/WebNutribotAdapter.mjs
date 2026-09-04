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
  #foodLogStore;
  #voiceMemoStore;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.inputRouter - NutribotInputRouter instance
   * @param {Object} [config.foodLogStore] - IFoodLogDatastore, for the
   *   pending-review query surface (listPendingByDate). The input router has
   *   no query-side methods of its own — this is the cleanest seam onto the
   *   store the nutribot container already holds, without threading a whole
   *   nutribot use case through the web adapter.
   * @param {Object} [config.voiceMemoStore] - VoiceMemoStore. When present,
   *   a voice capture's bytes are written to disk BEFORE transcription is
   *   attempted, so a transient upstream failure costs a retry rather than
   *   the recording. Absent, the behaviour is exactly as before.
   * @param {Object} [config.logger]
   */
  constructor(config) {
    if (!config.inputRouter) throw new Error('WebNutribotAdapter requires inputRouter');
    this.#inputRouter = config.inputRouter;
    this.#foodLogStore = config.foodLogStore || null;
    this.#voiceMemoStore = config.voiceMemoStore || null;
    this.#logger = config.logger || null;
  }

  #getLogger() {
    return this.#logger || console;
  }

  /**
   * Decode a `data:<mime>[;param=value...];base64,<payload>` URL into its
   * parts.
   *
   * The web frontend sends image/voice content as a data URL (see
   * PhotoCapture/VoiceCapture, `FileReader.readAsDataURL()`). VoiceCapture's
   * MediaRecorder mimeType routinely carries a codec param — e.g.
   * `audio/webm;codecs=opus` — producing `data:audio/webm;codecs=opus;base64,...`,
   * so the header can hold an arbitrary number of `;key=value` segments, not
   * just a single `;charset=`. Telegram's own path never calls this — it
   * always carries a real fileId string.
   *
   * @private
   * @param {string} dataUrl
   * @param {string} kind - Label for error messages ("image" | "voice")
   * @returns {{ mimeType: string, buffer: Buffer }}
   */
  #decodeDataUrl(dataUrl, kind) {
    if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
      throw new Error(`${kind} input requires a non-empty data URL string`);
    }
    const commaIndex = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || commaIndex === -1) {
      throw new Error(`${kind} input must be a base64 data URL (data:<mime-type>;base64,...)`);
    }
    const header = dataUrl.slice('data:'.length, commaIndex);
    const segments = header.split(';');
    if (segments[segments.length - 1] !== 'base64') {
      throw new Error(`${kind} input must be base64-encoded (data:<mime-type>;base64,...)`);
    }
    const mimeType = segments[0] || 'application/octet-stream';
    const buffer = Buffer.from(dataUrl.slice(commaIndex + 1), 'base64');
    if (buffer.length === 0) {
      throw new Error(`${kind} input decoded to an empty buffer`);
    }
    return { mimeType, buffer };
  }

  /**
   * Write a captured voice memo to the user's own store.
   *
   * NEVER throws: a store that is not configured, or a disk that refuses the
   * write, must not stop the transcription that was about to happen anyway.
   * Returns null when nothing was stored, which is what downstream reads as
   * "there is no saved copy to point the person at".
   *
   * @private
   * @returns {Promise<string|null>} audioRef
   */
  async #persistVoiceMemo(userId, buffer, mimeType) {
    if (!this.#voiceMemoStore) return null;
    try {
      return await this.#voiceMemoStore.save(userId, buffer, { mimeType });
    } catch (err) {
      this.#getLogger().warn?.('web-nutribot.voice.persist_failed', { userId, error: err.message });
      return null;
    }
  }

  /**
   * Process a nutrition input from the web UI.
   *
   * @param {Object} input
   * @param {string} input.type - "text" | "voice" | "image" | "barcode"
   * @param {string} [input.content] - Text/barcode string, or (for voice/image)
   *   a `data:<mime>;base64,...` data URL carrying the captured bytes.
   * @param {string} input.userId - Username
   * @param {string} [input.bucket] - Pre-validated meal-time bucket id
   *   ("morning" | "afternoon" | "evening" | "night") the capture was launched
   *   from. Validated by the HTTP boundary (health.mjs) before it ever reaches
   *   here — this adapter just threads it onto the event for the router's
   *   precedence seam (NutribotInputRouter#resolveMealTime).
   * @param {string} [input.audioRef] - A `va_*` ref for a voice memo ALREADY in
   *   this user's store. Supplied instead of `content` when a person retries a
   *   capture whose transcription failed: the bytes are read back rather than
   *   recorded again, which is the entire point of persisting them.
   * @param {string} [input.date] - Pre-validated `YYYY-MM-DD` day the client is
   *   LOOKING AT. Threaded onto the event the same way `bucket` is: the use
   *   cases date their rows by it, and the text parse treats it as "today" so
   *   "this morning" resolves against the viewed day. ABSENT MEANS TODAY.
   * @returns {Promise<Object>} Captured response from the bot pipeline
   */
  async process(input) {
    const { type, content, userId, bucket, date, audioRef: retryAudioRef } = input;
    const conversationId = `web:${userId}`;

    const event = {
      conversationId,
      userId,
      platform: 'web',
      platformUserId: userId,
      messageId: null,
      payload: { bucket: bucket || null, date: date || null },
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
      case 'voice': {
        // A RETRY reads the memo back rather than asking for it again — the
        // whole reason the bytes were written before the first attempt.
        if (retryAudioRef) {
          const stored = await this.#voiceMemoStore?.read(userId, retryAudioRef);
          if (!stored) {
            const err = new Error('That recording is no longer available');
            err.code = 'AUDIO_NOT_FOUND';
            throw err;
          }
          event.payload.fileId = { buffer: stored.buffer, mimeType: stored.mimeType, audioRef: retryAudioRef };
          break;
        }
        // handleVoice forwards event.payload.fileId straight through as
        // voiceData.fileId, which LogFoodFromVoice hands unchanged to
        // messagingGateway.transcribeVoice(fileId). Telegram passes a plain
        // fileId string there; TelegramAdapter.transcribeVoice also accepts
        // this { buffer, mimeType } shape and transcribes the buffer
        // directly, skipping the Telegram file-download step entirely.
        const { buffer, mimeType } = this.#decodeDataUrl(content, 'voice');
        // PERSIST FIRST, TRANSCRIBE SECOND. Until this landed the recording
        // existed only as this Buffer: when Whisper failed (2026-09-04, three
        // attempts, ETIMEDOUT then two socket hang-ups) the memo was gone and
        // the person had to say it all again. Storage failures are logged and
        // swallowed — losing the ability to RETRY is bad, but refusing to
        // transcribe a memo we could have transcribed is worse.
        const audioRef = await this.#persistVoiceMemo(userId, buffer, mimeType);
        event.payload.fileId = { buffer, mimeType, audioRef };
        break;
      }
      case 'image':
        // handleImage passes event.payload.imageUrl through as imageData.url.
        // LogFoodFromImage uses imageData.url as-is when no fileId is set, and
        // its aiGateway.chatWithImage() call accepts a base64 data URL
        // directly — no decoding needed for images, but we still validate the
        // shape (via #decodeDataUrl, discarding the buffer) so a malformed
        // payload fails fast here instead of surfacing as a confusing
        // downstream AI-analysis error. fileId stays null so the (unrelated)
        // fileId-resolution branch never fires.
        this.#decodeDataUrl(content, 'image');
        event.payload.fileId = null;
        event.payload.imageUrl = content;
        break;
      default:
        throw new Error(`Unsupported input type: ${type}`);
    }

    // Create a capture context that collects the bot's responses
    const captured = { messages: [], photos: [], logged: false, nutrilogUuid: null };
    const responseContext = this.#createCaptureContext(captured);

    this.#getLogger().debug?.('web-nutribot.process', { type, userId, conversationId });

    let routerResult = null;

    try {
      switch (routerType) {
        case 'text':
          routerResult = await this.#inputRouter.handleText(event, responseContext);
          break;
        case 'voice':
          routerResult = await this.#inputRouter.handleVoice(event, responseContext);
          break;
        case 'image':
          routerResult = await this.#inputRouter.handleImage(event, responseContext);
          break;
        case 'upc':
          routerResult = await this.#inputRouter.handleUpc(event, responseContext);
          break;
      }
    } catch (err) {
      this.#getLogger().error?.('web-nutribot.error', { type, userId, error: err.message });
      throw err;
    }

    // Extract final text from last captured message for convenience
    const lastMessage = captured.messages[captured.messages.length - 1];
    const responseText = lastMessage?.text || null;

    const response = {
      messages: captured.messages,
      photos: captured.photos,
      logged: captured.logged,
      responseText,
    };

    // Task 4.1 — surface the meal-time precedence outcome (computed once, in
    // NutribotInputRouter#resolveMealTime) to the HTTP caller: which bucket the
    // capture actually landed in, and whether that differs from the bucket the
    // request asked for (an explicitly-named meal beat it) — the "moved to
    // Lunch" cue. Only capture paths (#capture-wrapped handlers) set these;
    // callback/revision-only responses simply won't have them.
    if (routerResult && (routerResult.mealTime !== undefined || routerResult.moved !== undefined)) {
      response.mealTime = routerResult.mealTime ?? null;
      response.moved = routerResult.moved === true;
    }

    // A transcription that never happened is reported as such, not as a
    // silent empty result: the human-readable line is already in `messages`
    // (the Today view renders it in its notice banner), and these two fields
    // are what a client needs to offer a retry over the SAVED bytes rather
    // than asking the person to record again.
    if (routerType === 'voice' && routerResult?.result?.code === 'TRANSCRIBE_FAILED') {
      response.transcribeFailed = true;
      response.audioRef = routerResult.result.audioRef ?? null;
    }

    // Barcode lookups surface use-case-level fields (success, unknownUpc, upc,
    // product, nutrilogUuid) to the HTTP caller — `messages` from the capture
    // context always wins so the frontend's existing consumption is unaffected.
    if (routerType === 'upc' && routerResult?.result) {
      Object.assign(response, routerResult.result, { messages: captured.messages });
    }

    const outcome = routerResult?.result || {};
    response.committed = Boolean(routerResult?.committed || (routerType === 'upc' && outcome.success && outcome.nutrilogUuid));
    response.outcome = response.committed ? 'committed' : response.transcribeFailed ? 'retryable-failure' : response.unknownUpc ? 'unknown-food' : 'no-food';
    response.logId = outcome.nutrilogUuid || null;
    response.entryIds = (routerResult?.items || []).map(item => item.uuid || item.id).filter(Boolean);
    response.message = responseText;
    return response;
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
  /**
   * Process a callback action (Accept, Revise, Discard) from the web UI.
   *
   * @param {Object} input
   * @param {string} input.callbackData - JSON callback data from the button (e.g., '{"cmd":"a","id":"..."}')
   * @param {string} input.userId - Username
   * @param {string} [input.messageId] - Message ID the callback refers to
   * @returns {Promise<Object>} Captured response
   */
  async processCallback(input) {
    const { callbackData, userId, messageId } = input;
    const conversationId = `web:${userId}`;

    const event = {
      conversationId,
      userId,
      platform: 'web',
      platformUserId: userId,
      messageId: messageId || null,
      payload: {
        callbackData,
      },
    };

    const captured = { messages: [], photos: [], logged: false };
    const responseContext = this.#createCaptureContext(captured);

    this.#getLogger().debug?.('web-nutribot.callback', { userId, callbackData });

    try {
      await this.#inputRouter.handleCallback(event, responseContext);
    } catch (err) {
      this.#getLogger().error?.('web-nutribot.callback.error', { userId, error: err.message });
      throw err;
    }

    return {
      messages: captured.messages,
      photos: captured.photos,
      logged: captured.logged,
      responseText: captured.messages[captured.messages.length - 1]?.text || null,
    };
  }

  /**
   * List pending NutriLogs for a single meal.date — the query behind the web
   * Today view's "Needs review" surface.
   *
   * @param {string} userId
   * @param {string} date - Date (YYYY-MM-DD)
   * @returns {Promise<import('#domains/nutrition/entities/NutriLog.mjs').NutriLog[]>}
   */
  async listPendingByDate(userId, date) {
    if (!this.#foodLogStore) {
      throw new Error('WebNutribotAdapter has no foodLogStore configured');
    }
    return this.#foodLogStore.findPendingByDate(userId, date);
  }

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
