/**
 * TTSAdapter - Text-to-Speech using OpenAI API
 *
 * Provides speech synthesis using OpenAI's TTS API.
 * Features:
 * - Multiple voice options (alloy, echo, fable, onyx, nova, shimmer)
 * - Custom voice instructions
 * - Audio streaming response
 *
 * @module adapters/hardware/tts
 */

import axios from 'axios';

/**
 * @typedef {Object} TTSConfig
 * @property {string} apiKey - OpenAI API key
 * @property {string} [model='tts-1'] - TTS model (tts-1 or tts-1-hd)
 * @property {string} [defaultVoice='alloy'] - Default voice
 */

/**
 * @typedef {'alloy'|'echo'|'fable'|'onyx'|'nova'|'shimmer'} Voice
 */

export class TTSAdapter {
  #apiKey;
  #model;
  #defaultVoice;
  #logger;
  #apiUrl;

  /**
   * @param {TTSConfig} config
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#apiKey = config.apiKey;
    this.#model = config.model || 'tts-1';
    this.#defaultVoice = config.defaultVoice || 'alloy';
    this.#logger = options.logger || console;
    this.#apiUrl = 'https://api.openai.com/v1/audio/speech';
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#apiKey);
  }

  /**
   * Get available voices
   * @returns {Voice[]}
   */
  getAvailableVoices() {
    return ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  }

  /**
   * Get available models
   * @returns {string[]}
   */
  getAvailableModels() {
    return ['tts-1', 'tts-1-hd'];
  }

  /**
   * Generate speech from text
   * @param {string} text - Text to synthesize
   * @param {Object} [options]
   * @param {Voice} [options.voice] - Voice to use
   * @param {string} [options.model] - Model to use
   * @param {string} [options.responseFormat='mp3'] - Output format (mp3, opus, aac, flac)
   * @param {number} [options.speed=1.0] - Speed (0.25 to 4.0)
   * @returns {Promise<ReadableStream>} Audio stream
   */
  async generateSpeech(text, options = {}) {
    if (!this.#apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!text || typeof text !== 'string') {
      throw new Error('Text is required');
    }

    const voice = options.voice || this.#defaultVoice;
    const model = options.model || this.#model;

    this.#logger.info?.('tts.generate.start', {
      textLength: text.length,
      voice,
      model
    });

    try {
      const requestBody = {
        model,
        input: text,
        voice
      };

      if (options.responseFormat) {
        requestBody.response_format = options.responseFormat;
      }

      if (options.speed) {
        requestBody.speed = Math.max(0.25, Math.min(4.0, options.speed));
      }

      const response = await axios({
        method: 'post',
        url: this.#apiUrl,
        headers: {
          'Authorization': `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json'
        },
        data: requestBody,
        responseType: 'stream'
      });

      this.#logger.info?.('tts.generate.success', {
        textLength: text.length,
        voice,
        model
      });

      return response.data;

    } catch (error) {
      this.#logger.error?.('tts.generate.error', {
        error: error.message,
        status: error.response?.status
      });
      throw error;
    }
  }

  /**
   * Generate speech and return as buffer
   * @param {string} text - Text to synthesize
   * @param {Object} [options] - Same as generateSpeech
   * @returns {Promise<Buffer>} Audio buffer
   */
  async generateSpeechBuffer(text, options = {}) {
    const stream = await this.generateSpeech(text, options);

    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Get adapter status
   * @returns {Object}
   */
  getStatus() {
    return {
      configured: this.isConfigured(),
      model: this.#model,
      defaultVoice: this.#defaultVoice,
      availableVoices: this.getAvailableVoices()
    };
  }
}

/**
 * Create a TTSAdapter from environment config
 * @param {Object} [options]
 * @returns {TTSAdapter}
 */
export function createTTSAdapter(options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.TTS_MODEL || 'tts-1';
  const defaultVoice = process.env.TTS_DEFAULT_VOICE || 'alloy';

  return new TTSAdapter({ apiKey, model, defaultVoice }, options);
}

export default TTSAdapter;
