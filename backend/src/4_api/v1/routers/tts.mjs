/**
 * TTS Router
 *
 * API endpoints for text-to-speech:
 * - Generate speech from text
 * - Voice and model selection
 *
 * @module api/routers
 */

import express from 'express';

/**
 * Create TTS router
 * @param {Object} config
 * @param {import('../../2_adapters/hardware/tts/TTSAdapter.mjs').TTSAdapter} config.ttsAdapter
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createTTSRouter(config) {
  const router = express.Router();
  const { ttsAdapter, logger = console } = config;

  router.use(express.json({ strict: false }));

  // ============================================================================
  // Info Endpoints
  // ============================================================================

  /**
   * GET /tts
   * API info and status
   */
  router.get('/', (req, res) => {
    const status = ttsAdapter.getStatus();
    res.json({
      message: 'Text-to-Speech API',
      status: 'success',
      ...status,
      endpoints: {
        'GET /': 'This info message',
        'GET /voices': 'List available voices',
        'POST /generate': 'Generate speech from text',
        'GET /generate': 'Generate speech from query params'
      }
    });
  });

  /**
   * GET /tts/voices
   * List available voices
   */
  router.get('/voices', (req, res) => {
    res.json({
      voices: ttsAdapter.getAvailableVoices(),
      models: ttsAdapter.getAvailableModels()
    });
  });

  // ============================================================================
  // Speech Generation
  // ============================================================================

  /**
   * POST /tts/generate
   * Generate speech from text (POST body)
   */
  router.post('/generate', async (req, res) => {
    const {
      string,
      text,
      voice,
      model,
      instructions,
      speed,
      responseFormat
    } = req.body || {};

    const inputText = string || text;

    if (!inputText) {
      return res.status(400).json({ error: 'Text is required (use "string" or "text" field)' });
    }

    await generateAndStream(inputText, { voice, model, speed, responseFormat }, res, logger, ttsAdapter);
  });

  /**
   * GET /tts/generate
   * Generate speech from query params
   */
  router.get('/generate', async (req, res) => {
    const {
      string,
      text,
      voice,
      model,
      speed,
      responseFormat
    } = req.query;

    const inputText = string || text || 'Hello world! This is a test of the text-to-speech system.';

    await generateAndStream(inputText, { voice, model, speed: parseFloat(speed) || undefined, responseFormat }, res, logger, ttsAdapter);
  });

  /**
   * ALL /tts/generate (for compatibility)
   * Handle both GET and POST
   */
  router.all('/generate', async (req, res, next) => {
    // Already handled by specific routes above
    if (req.method === 'GET' || req.method === 'POST') {
      return next('route');
    }

    const body = req.body || {};
    const query = req.query || {};
    const inputText = body.string || body.text || query.string || query.text || 'Hello world!';
    const voice = body.voice || query.voice;
    const model = body.model || query.model;

    await generateAndStream(inputText, { voice, model }, res, logger, ttsAdapter);
  });

  return router;
}

/**
 * Generate speech and stream to response
 * @param {string} text
 * @param {Object} options
 * @param {express.Response} res
 * @param {Object} logger
 * @param {TTSAdapter} ttsAdapter
 */
async function generateAndStream(text, options, res, logger, ttsAdapter) {
  try {
    logger.info?.('tts.generate.request', {
      textLength: text.length,
      voice: options.voice,
      model: options.model
    });

    const audioStream = await ttsAdapter.generateSpeech(text, options);

    if (audioStream && typeof audioStream.pipe === 'function') {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      audioStream.on('error', (err) => {
        logger.error?.('tts.stream.error', { error: err.message });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming audio' });
        }
      });

      audioStream.pipe(res);
    } else {
      res.status(500).json({ error: 'Error generating speech' });
    }
  } catch (error) {
    logger.error?.('tts.generate.error', { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Error generating speech' });
    }
  }
}

export default createTTSRouter;
