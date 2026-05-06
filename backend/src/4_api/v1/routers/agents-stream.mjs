// backend/src/4_api/v1/routers/agents-stream.mjs

/**
 * Streaming variant of /api/v1/agents/:agentId/run.
 *
 * Reads the orchestrator's streamExecute() async generator and emits
 * each chunk as an SSE event. Ends with a 'done' event on success or
 * 'error' on failure.
 */
import { Router } from 'express';

/**
 * @param {Object} config
 * @param {Object} config.orchestrator - AgentOrchestrator with streamExecute()
 * @param {Object} [config.logger]     - Logger instance
 * @returns {express.Router}
 */
export function createAgentsStreamRouter({ orchestrator, logger = console }) {
  const router = Router();

  router.post('/:agentId/run-stream', async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body || {};

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      logger.info?.('agents.runStream.start', { agentId });
      for await (const chunk of orchestrator.streamExecute(agentId, input, context)) {
        send(chunk);
      }
      send({ type: 'done' });
      res.end();
      logger.info?.('agents.runStream.complete', { agentId });
    } catch (err) {
      logger.error?.('agents.runStream.error', { agentId, error: err.message });
      send({ type: 'error', message: err.message });
      res.end();
    }
  });

  return router;
}

export default createAgentsStreamRouter;
