// backend/src/4_api/routers/agents.mjs

/**
 * Agents API Router
 *
 * Endpoints:
 * - GET  /api/agents - List available agents
 * - POST /api/agents/:agentId/run - Run an agent synchronously
 * - POST /api/agents/:agentId/run-background - Run an agent in background
 */

import express from 'express';

/**
 * Create agents API router
 *
 * @param {Object} config
 * @param {Object} config.agentOrchestrator - AgentOrchestrator instance
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAgentsRouter(config) {
  const router = express.Router();
  const { agentOrchestrator, logger = console } = config;

  if (!agentOrchestrator) {
    throw new Error('agentOrchestrator is required');
  }

  /**
   * GET /api/agents
   * List all registered agents
   */
  router.get('/', (req, res) => {
    try {
      const agents = agentOrchestrator.list();
      res.json({ agents });
    } catch (error) {
      logger.error?.('agents.list.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/:agentId/run
   * Run an agent synchronously
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    try {
      logger.info?.('agents.run.request', { agentId, inputLength: input.length });

      const result = await agentOrchestrator.run(agentId, input, context);

      res.json({
        agentId,
        output: result.output,
        toolCalls: result.toolCalls,
      });
    } catch (error) {
      logger.error?.('agents.run.error', { agentId, error: error.message });

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/:agentId/run-background
   * Run an agent in background (returns immediately)
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run-background', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    try {
      logger.info?.('agents.runBackground.request', { agentId });

      const { taskId } = await agentOrchestrator.runInBackground(agentId, input, context);

      res.status(202).json({
        agentId,
        taskId,
        status: 'accepted',
      });
    } catch (error) {
      logger.error?.('agents.runBackground.error', { agentId, error: error.message });

      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }

      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default createAgentsRouter;
