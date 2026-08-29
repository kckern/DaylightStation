/**
 * AI API Router
 *
 * REST API endpoints for AI operations.
 * Supports multiple AI providers (OpenAI, Anthropic).
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create router with an application AI capability.
 * @param {Object} deps
 * @param {Object} deps.aiService
 * @param {Object} [deps.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAIRouter(deps) {
  const { aiService } = deps;
  const router = express.Router();

  /**
   * GET /api/ai
   * Get AI module status
   */
  router.get('/', (req, res) => {
    res.json(aiService.status());
  });

  /**
   * POST /api/ai/chat
   * Send chat messages and get response
   */
  router.post('/chat', asyncHandler(async (req, res) => {
    const { messages, provider, model, maxTokens, temperature } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const result = await aiService.chat(messages, { provider, model, maxTokens, temperature });
    if (!result) {
      return res.status(503).json({ error: 'No AI provider configured' });
    }
    res.json(result);
  }));

  /**
   * POST /api/ai/chat/json
   * Send chat messages and get JSON response
   */
  router.post('/chat/json', asyncHandler(async (req, res) => {
    const { messages, provider, model, maxTokens, temperature } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const result = await aiService.chatJson(messages, { provider, model, maxTokens, temperature });
    if (!result) {
      return res.status(503).json({ error: 'No AI provider configured' });
    }
    res.json(result);
  }));

  /**
   * POST /api/ai/chat/vision
   * Send chat with image for vision analysis
   */
  router.post('/chat/vision', asyncHandler(async (req, res) => {
    const { messages, imageUrl, provider, model, maxTokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required' });
    }

    const result = await aiService.chatVision(messages, imageUrl, { provider, model, maxTokens });
    if (!result) {
      return res.status(503).json({ error: 'No AI provider configured' });
    }
    res.json(result);
  }));

  /**
   * POST /api/ai/transcribe
   * Transcribe audio to text (OpenAI Whisper only)
   */
  router.post('/transcribe', asyncHandler(async (req, res) => {
    if (!aiService.supportsTranscription()) {
      return res.status(503).json({ error: 'OpenAI not configured (required for transcription)' });
    }
    const { audioBase64, language, prompt } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'audioBase64 is required' });
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await aiService.transcribe(audioBuffer, { language, prompt });
    if (!result) return res.status(503).json({ error: 'OpenAI not configured (required for transcription)' });
    res.json(result);
  }));

  /**
   * POST /api/ai/embed
   * Generate text embedding (OpenAI only)
   */
  router.post('/embed', asyncHandler(async (req, res) => {
    if (!aiService.supportsEmbedding()) {
      return res.status(503).json({ error: 'OpenAI not configured (required for embeddings)' });
    }
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const result = await aiService.embed(text);
    if (!result) return res.status(503).json({ error: 'OpenAI not configured (required for embeddings)' });
    res.json(result);
  }));

  /**
   * GET /api/ai/metrics
   * Get adapter metrics
   */
  router.get('/metrics', (req, res) => {
    res.json(aiService.metrics());
  });

  /**
   * POST /api/ai/metrics/reset
   * Reset adapter metrics
   */
  router.post('/metrics/reset', (req, res) => {
    res.json(aiService.resetMetrics());
  });

  return router;
}

export default createAIRouter;
