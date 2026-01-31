/**
 * TelegramVoiceTranscriptionService
 *
 * Simple transcription service for Telegram voice messages.
 * Downloads audio from URL and transcribes via OpenAI Whisper.
 */

import { ITranscriptionService } from '#apps/shared/ports/ITranscriptionService.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class TelegramVoiceTranscriptionService extends ITranscriptionService {
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
    super();

    if (!config?.openaiAdapter) {
      throw new InfrastructureError('openaiAdapter is required', {
        code: 'MISSING_CONFIG',
        field: 'openaiAdapter'
      });
    }
    if (!deps.httpClient) {
      throw new InfrastructureError('TelegramVoiceTranscriptionService requires httpClient', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'httpClient'
      });
    }
    this.#openaiAdapter = config.openaiAdapter;
    this.#httpClient = deps.httpClient;
    this.#logger = deps.logger || console;
  }

  /**
   * Transcribe audio buffer to text
   * @param {Buffer} audioBuffer - Audio data (ogg, mp3, wav, etc.)
   * @param {Object} [options] - Transcription options
   * @returns {Promise<{text: string}>} Transcription result
   */
  async transcribe(audioBuffer, options = {}) {
    this.#logger.debug?.('telegram-voice.transcribe.buffer', {
      size: audioBuffer?.length
    });

    try {
      const text = await this.#openaiAdapter.transcribe(audioBuffer, {
        filename: options.filename || 'audio.ogg',
        contentType: options.contentType || 'audio/ogg',
        language: options.language,
        prompt: options.prompt
      });

      return { text };
    } catch (error) {
      this.#logger.error?.('telegram-voice.transcribe.error', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Transcribe audio from URL (primary use case for Telegram voice messages)
   * @param {string} audioUrl - URL to audio file (Telegram file URL)
   * @param {Object} [options] - Transcription options
   * @returns {Promise<{text: string}>} Transcription result
   */
  async transcribeUrl(audioUrl, options = {}) {
    this.#logger.debug?.('telegram-voice.transcribe.start', { url: audioUrl?.substring(0, 50) });

    try {
      // Download audio file
      const audioBuffer = await this.#downloadAudio(audioUrl);

      // Determine format from URL
      const ext = this.#resolveExtension(audioUrl);

      // Transcribe via OpenAI Whisper
      const text = await this.#openaiAdapter.transcribe(audioBuffer, {
        filename: `voice.${ext}`,
        contentType: `audio/${ext === 'oga' ? 'ogg' : ext}`,
        language: options.language,
        prompt: options.prompt
      });

      this.#logger.debug?.('telegram-voice.transcribe.success', {
        textLength: text?.length
      });

      return { text };
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
   * @returns {boolean}
   */
  isConfigured() {
    return this.#openaiAdapter?.isConfigured?.() ?? false;
  }

  /**
   * Get supported audio formats
   * @returns {string[]}
   */
  getSupportedFormats() {
    return ['ogg', 'oga', 'mp3', 'm4a', 'wav', 'webm'];
  }
}

export default TelegramVoiceTranscriptionService;
