/**
 * ITranscriptionService Port Interface
 *
 * Port for audio transcription services.
 * Implementations: OpenAI Whisper, local models
 */

/**
 * @typedef {Object} TranscriptionOptions
 * @property {string} [language] - Language hint (ISO 639-1 code)
 * @property {string} [prompt] - Prompt to guide transcription style
 * @property {string} [format] - Output format (text, srt, vtt)
 */

/**
 * @typedef {Object} TranscriptionResult
 * @property {string} text - Transcribed text
 * @property {string} [language] - Detected language
 * @property {number} [duration] - Audio duration in seconds
 * @property {Array} [segments] - Timestamped segments (if supported)
 */

export class ITranscriptionService {
  /**
   * Transcribe audio buffer to text
   * @param {Buffer} audioBuffer - Audio data (ogg, mp3, wav, etc.)
   * @param {TranscriptionOptions} [options] - Transcription options
   * @returns {Promise<TranscriptionResult>}
   */
  async transcribe(audioBuffer, options = {}) {
    throw new Error('ITranscriptionService.transcribe must be implemented');
  }

  /**
   * Transcribe audio from URL
   * @param {string} audioUrl - URL to audio file
   * @param {TranscriptionOptions} [options] - Transcription options
   * @returns {Promise<TranscriptionResult>}
   */
  async transcribeUrl(audioUrl, options = {}) {
    throw new Error('ITranscriptionService.transcribeUrl must be implemented');
  }

  /**
   * Check if service is configured
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error('ITranscriptionService.isConfigured must be implemented');
  }

  /**
   * Get supported audio formats
   * @returns {string[]}
   */
  getSupportedFormats() {
    throw new Error('ITranscriptionService.getSupportedFormats must be implemented');
  }
}

export default ITranscriptionService;
