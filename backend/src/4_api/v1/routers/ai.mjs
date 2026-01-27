/**
 * AI API Router
 *
 * REST API endpoints for AI operations.
 * Supports multiple AI providers (OpenAI, Anthropic).
 */
import express from 'express';

const router = express.Router();

/**
 * Create router with pre-built adapters
 * @param {Object} deps
 * @param {Object} [deps.openaiAdapter] - Pre-built OpenAI adapter (optional)
 * @param {Object} [deps.anthropicAdapter] - Pre-built Anthropic adapter (optional)
 * @param {Object} [deps.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAIRouter(deps) {
  const { openaiAdapter, anthropicAdapter, logger } = deps;

  /**
   * Get adapter by provider name
   */
  function getAdapter(provider) {
    if (provider === 'anthropic' && anthropicAdapter) {
      return anthropicAdapter;
    }
    if (provider === 'openai' && openaiAdapter) {
      return openaiAdapter;
    }
    // Default to OpenAI if available, otherwise Anthropic
    return openaiAdapter || anthropicAdapter;
  }

  /**
   * GET /api/ai
   * Get AI module status
   */
  router.get('/', (req, res) => {
    res.json({
      module: 'ai',
      providers: {
        openai: {
          configured: !!openaiAdapter,
          model: openaiAdapter?.model || null
        },
        anthropic: {
          configured: !!anthropicAdapter,
          model: anthropicAdapter?.model || null
        }
      }
    });
  });

  /**
   * POST /api/ai/chat
   * Send chat messages and get response
   */
  router.post('/chat', async (req, res) => {
    try {
      const { messages, provider, model, maxTokens, temperature } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const adapter = getAdapter(provider);
      if (!adapter) {
        return res.status(503).json({ error: 'No AI provider configured' });
      }

      const response = await adapter.chat(messages, { model, maxTokens, temperature });

      res.json({
        response,
        provider: provider || (adapter === openaiAdapter ? 'openai' : 'anthropic')
      });
    } catch (error) {
      logger?.error?.('ai.chat.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/chat/json
   * Send chat messages and get JSON response
   */
  router.post('/chat/json', async (req, res) => {
    try {
      const { messages, provider, model, maxTokens, temperature } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const adapter = getAdapter(provider);
      if (!adapter) {
        return res.status(503).json({ error: 'No AI provider configured' });
      }

      const response = await adapter.chatWithJson(messages, { model, maxTokens, temperature });

      res.json({
        response,
        provider: provider || (adapter === openaiAdapter ? 'openai' : 'anthropic')
      });
    } catch (error) {
      logger?.error?.('ai.chatJson.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/chat/vision
   * Send chat with image for vision analysis
   */
  router.post('/chat/vision', async (req, res) => {
    try {
      const { messages, imageUrl, provider, model, maxTokens } = req.body;

      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Messages array is required' });
      }
      if (!imageUrl) {
        return res.status(400).json({ error: 'imageUrl is required' });
      }

      const adapter = getAdapter(provider);
      if (!adapter) {
        return res.status(503).json({ error: 'No AI provider configured' });
      }

      const response = await adapter.chatWithImage(messages, imageUrl, { model, maxTokens });

      res.json({
        response,
        provider: provider || (adapter === openaiAdapter ? 'openai' : 'anthropic')
      });
    } catch (error) {
      logger?.error?.('ai.vision.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/transcribe
   * Transcribe audio to text (OpenAI Whisper only)
   */
  router.post('/transcribe', async (req, res) => {
    try {
      if (!openaiAdapter) {
        return res.status(503).json({ error: 'OpenAI not configured (required for transcription)' });
      }

      const { audioBase64, language, prompt } = req.body;

      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required' });
      }

      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const text = await openaiAdapter.transcribe(audioBuffer, { language, prompt });

      res.json({ text, provider: 'openai' });
    } catch (error) {
      logger?.error?.('ai.transcribe.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/ai/embed
   * Generate text embedding (OpenAI only)
   */
  router.post('/embed', async (req, res) => {
    try {
      if (!openaiAdapter) {
        return res.status(503).json({ error: 'OpenAI not configured (required for embeddings)' });
      }

      const { text } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'text is required' });
      }

      const embedding = await openaiAdapter.embed(text);

      res.json({
        embedding,
        dimensions: embedding.length,
        provider: 'openai'
      });
    } catch (error) {
      logger?.error?.('ai.embed.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/ai/metrics
   * Get adapter metrics
   */
  router.get('/metrics', (req, res) => {
    const metrics = {
      openai: openaiAdapter?.getMetrics() || null,
      anthropic: anthropicAdapter?.getMetrics() || null
    };

    res.json(metrics);
  });

  /**
   * POST /api/ai/metrics/reset
   * Reset adapter metrics
   */
  router.post('/metrics/reset', (req, res) => {
    openaiAdapter?.resetMetrics();
    anthropicAdapter?.resetMetrics();

    res.json({ success: true });
  });

  return router;
}

export default router;
