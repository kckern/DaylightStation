/**
 * Log Food From Voice Use Case
 * @module nutribot/usecases/LogFoodFromVoice
 *
 * Transcribes voice message and delegates to LogFoodFromText.
 */

// The same set retryTransient treats as retryable. Spelled out here rather
// than imported from #system: this layer classifies for LOGGING only — it does
// not retry — and an application use case reaching into the system layer for a
// constant is exactly the coupling the layer rules exist to prevent.
const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED',
  'EAI_AGAIN', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
]);

/**
 * Log food from voice use case
 */
export class LogFoodFromVoice {
  #messagingGateway;
  #logFoodFromText;
  #logger;
  #transcribeAudio;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.logFoodFromText) throw new Error('logFoodFromText is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#transcribeAudio = deps.transcribeAudio;
    this.#logFoodFromText = deps.logFoodFromText;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      // ResponseContext never has transcribeVoice (it's platform-agnostic)
      // We always need the messagingGateway for voice transcription
      return {
        sendMessage: (text, options) => responseContext.sendMessage(text, options),
        deleteMessage: (msgId) => responseContext.deleteMessage(msgId),
        transcribeVoice: (fileId) => fileId?.buffer && this.#transcribeAudio
          ? this.#transcribeAudio(fileId) : this.#messagingGateway.transcribeVoice(fileId),
        createStatusIndicator: responseContext.createStatusIndicator?.bind(responseContext),
      };
    }
    // Fallback to gateway directly
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      deleteMessage: (msgId) => this.#messagingGateway.deleteMessage(conversationId, msgId),
      transcribeVoice: (fileId) => this.#messagingGateway.transcribeVoice(fileId),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId
   * @param {string} input.conversationId
   * @param {Object} input.voiceData - { fileId }
   * @param {string} [input.messageId]
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { userId, conversationId, voiceData, messageId, asOfDate = null, responseContext } = input;
    // Set only where the bytes were written to the user's store before this
    // call (the web path). It is the difference between telling someone their
    // recording is safe and telling them it is gone.
    const audioRef = voiceData?.audioRef || null;

    this.#logger.debug?.('logVoice.start', { conversationId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

    // Create status indicator for transcription phase
    let status = null;
    if (messaging.createStatusIndicator) {
      try {
        status = await messaging.createStatusIndicator(
          '🎤 Transcribing',
          { frames: ['.', '..', '...'], interval: 1500 }
        );
      } catch (statusError) {
        // Non-fatal: continue without status indicator if Telegram send fails
        this.#logger.warn?.('logVoice.statusIndicator.failed', {
          conversationId,
          error: statusError.message,
        });
      }
    }

    try {
      // 1. Transcribe voice
      let transcription;
      try {
        transcription = await messaging.transcribeVoice(voiceData.fileId);
      } catch (transcribeError) {
        // TWO FAILURES, ONE EXIT. A missing config is permanent; a network
        // failure is not — but both end the same way, with a plain message
        // and no choices, which is exactly how "no food detected" already
        // ends and what the web Today view renders in its notice banner.
        //
        // The transient case used to RE-THROW, and surfaced to the person as
        // `HTTP 500: {"error":"socket hang up"}` (2026-09-04) — a stack-trace
        // fragment that says nothing about what to do next, on a request that
        // had already thrown their recording away. Now it says what happened
        // and, when the memo was written to their store first, that it is
        // safe. "Saved" is claimed ONLY when something actually was: a
        // reassurance that turns out to be false is worse than no reassurance.
        const missingConfig = transcribeError.code === 'MISSING_CONFIG'
          || transcribeError.message?.includes('not configured');

        // Every transcription failure reads the same to the person, but they
        // must NOT read the same in the log. A network cut is expected weather
        // (warn); anything else reaching here is a bug this friendly message
        // would otherwise hide, so it is logged at error and stays findable.
        const code = transcribeError.code || transcribeError.cause?.code || null;
        const transient = transcribeError.isTransient === true || TRANSIENT_CODES.has(code);
        if (!missingConfig) {
          const level = transient ? 'warn' : 'error';
          this.#logger[level]?.('logVoice.transcribe.failed', {
            conversationId, audioRef, code, transient, error: transcribeError.message,
          });
        }

        const message = missingConfig
          ? '🎤 Voice messages are not fully supported yet. Please type what you ate.'
          : (audioRef
            ? "🎤 I couldn't reach the transcriber just now — your recording is saved, so try again in a moment."
            : "🎤 I couldn't reach the transcriber just now. Please try again, or type what you ate.");

        if (status) {
          await status.finish(message);
        } else {
          await messaging.sendMessage(message, {});
        }

        return {
          success: false,
          code: missingConfig ? 'VOICE_UNAVAILABLE' : 'TRANSCRIBE_FAILED',
          audioRef,
          error: missingConfig ? 'Voice transcription not available' : transcribeError.message,
        };
      }

      if (!transcription || transcription.trim().length === 0) {
        if (status) {
          await status.finish("❓ I couldn't understand the voice message. Could you type what you ate?");
        } else {
          await messaging.sendMessage("❓ I couldn't understand the voice message. Could you type what you ate?", {});
        }
        return { success: false, error: 'Empty transcription' };
      }

      // Cancel transcription status - LogFoodFromText will show its own "Analyzing..." status
      if (status) {
        await status.cancel();
      }

      this.#logger.debug?.('logVoice.transcribed', {
        conversationId,
        length: transcription.length,
      });

      // 2. Delegate to LogFoodFromText
      const result = await this.#logFoodFromText.execute({
        userId,
        conversationId,
        text: transcription,
        // The spoken words are parsed against the day the person is LOOKING
        // AT, not the server's today — a memo recorded while viewing yesterday
        // must land on yesterday.
        asOfDate,
        responseContext,
      });

      // 3. Delete original voice message after analysis appears
      if (messageId && result.success) {
        try {
          await messaging.deleteMessage( messageId);
        } catch (e) {
          // Ignore delete errors
        }
      }

      this.#logger.info?.('logVoice.complete', {
        conversationId,
        success: result.success,
      });

      return result;
    } catch (error) {
      this.#logger.error?.('logVoice.error', { conversationId, error: error.message });

      const isTransportError = error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'ECONNRESET' ||
        error.isTransient === true;

      try {
        const errorMessage = isTransportError
          ? `⚠️ Network issue while updating the message. Your food may have been logged.\n\nPlease check your recent entries or try again.\n\n_Error: ${error.message || 'Connection issue'}_`
          : `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Unknown error'}_`;

        if (status) {
          await status.finish(errorMessage);
        } else {
          await messaging.sendMessage(errorMessage, { parse_mode: 'Markdown' });
        }
      } catch (sendError) {
        this.#logger.error?.('logVoice.errorNotification.failed', {
          conversationId,
          originalError: error.message,
          sendError: sendError.message,
        });
      }

      throw error; // Re-throw instead of returning {success: false}
    }
  }
}

export default LogFoodFromVoice;
