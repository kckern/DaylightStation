/**
 * TelegramVoiceTranscriptionService
 *
 * Simple transcription service for Telegram voice messages.
 * Downloads audio from URL and transcribes via OpenAI Whisper.
 */

export class TelegramVoiceTranscriptionService {
  #openaiAdapter;
  #httpClient;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.openaiAdapter - OpenAIAdapter instance
   * @param {Object} deps
   * @param {import('#system/services/HttpClient.mjs').HttpClient} deps.httpClient
   * @param {Object} [deps.logger=console]
   */
  constructor(config, deps = {}) {
    if (!config?.openaiAdapter) {
      throw new Error('openaiAdapter is required');
    }
    if (!deps.httpClient) {
      throw new Error('TelegramVoiceTranscriptionService requires httpClient');
    }
    this.#openaiAdapter = config.openaiAdapter;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  /**
   * Transcribe audio from URL
   * @param {string} audioUrl - URL to audio file (Telegram file URL)
   * @returns {Promise<string>} Transcribed text
   */
  async transcribe(audioUrl) {
    this.#logger.debug?.('telegram-voice.transcribe.start', { url: audioUrl?.substring(0, 50) });

    try {
      // Download audio file
      const audioBuffer = await this.#downloadAudio(audioUrl);

      // Determine format from URL
      const ext = this.#resolveExtension(audioUrl);

      // Transcribe via OpenAI Whisper
      const text = await this.#openaiAdapter.transcribe(audioBuffer, {
        filename: `voice.${ext}`,
        contentType: `audio/${ext === 'oga' ? 'ogg' : ext}`
      });

      this.#logger.debug?.('telegram-voice.transcribe.success', {
        textLength: text?.length
      });

      return text;
    } catch (error) {
      this.#logger.error?.('telegram-voice.transcribe.error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Download audio file from URL
   * @private
   */
  async #downloadAudio(url) {
    try {
      return await this.#httpClient.downloadBuffer(url);
    } catch (error) {
      this.#logger.error?.('telegram-voice.download.failed', {
        error: error.message,
        code: error.code
      });
      const wrapped = new Error('Failed to download audio');
      wrapped.code = error.code || 'DOWNLOAD_ERROR';
      wrapped.isTransient = error.isTransient || false;
      throw wrapped;
    }
  }

  /**
   * Resolve file extension from URL
   * @private
   */
  #resolveExtension(url) {
    if (!url) return 'ogg';
    // Telegram voice messages are typically .oga (Ogg audio)
    if (url.includes('.oga')) return 'oga';
    if (url.includes('.ogg')) return 'ogg';
    if (url.includes('.mp3')) return 'mp3';
    if (url.includes('.m4a')) return 'm4a';
    if (url.includes('.wav')) return 'wav';
    if (url.includes('.webm')) return 'webm';
    return 'ogg';
  }

  /**
   * Check if service is configured
   */
  isConfigured() {
    return this.#openaiAdapter?.isConfigured?.() ?? false;
  }
}

export default TelegramVoiceTranscriptionService;
