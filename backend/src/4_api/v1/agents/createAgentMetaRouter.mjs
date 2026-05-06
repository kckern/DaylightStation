// backend/src/4_api/v1/agents/createAgentMetaRouter.mjs
import express from 'express';

/**
 * Agent listing + assignment endpoints — agent-agnostic; mounted ONCE at /api/v1/agents.
 *
 * Routes:
 *   GET  /                                       — list all registered agents
 *   GET  /:agentId/assignments                   — list assignments for an agent
 *   POST /:agentId/assignments/:assignmentId/run — manually trigger an assignment
 */
export function createAgentMetaRouter({ orchestrator, logger = console } = {}) {
  if (!orchestrator) throw new Error('createAgentMetaRouter: orchestrator required');

  const router = express.Router();

  /**
   * GET /
   * List all registered agents
   */
  router.get('/', async (_req, res, next) => {
    try {
      res.json({ agents: orchestrator.list() });
    } catch (e) { next(e); }
  });

  /**
   * GET /:agentId/assignments
   * List assignments for an agent
   */
  router.get('/:agentId/assignments', async (req, res, next) => {
    try {
      const { agentId } = req.params;
      if (!orchestrator.has(agentId)) {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      const instances = orchestrator.listInstances?.() ?? [];
      const agent = instances.find((a) => a?.constructor?.id === agentId);
      const assignments = (agent?.getAssignments?.() || []).map((a) => ({
        id: a.constructor.id,
        description: a.constructor.description || '',
        schedule: a.constructor.schedule || null,
      }));
      res.json({ agentId, assignments });
    } catch (e) { next(e); }
  });

  /**
   * POST /:agentId/assignments/:assignmentId/run
   * Manually trigger an assignment
   * Body: { userId?: string, context?: object }
   */
  router.post('/:agentId/assignments/:assignmentId/run', async (req, res, next) => {
    try {
      const { agentId, assignmentId } = req.params;
      const { userId, context = {} } = req.body || {};
      logger.info?.('agents.runAssignment.request', { agentId, assignmentId, userId });
      try {
        const result = await orchestrator.runAssignment(agentId, assignmentId, {
          userId,
          context,
          triggeredBy: 'api',
        });
        res.json({ agentId, assignmentId, status: 'complete', result });
      } catch (error) {
        logger.error?.('agents.runAssignment.error', { agentId, assignmentId, error: error.message });
        if (/not found|Unknown assignment/i.test(error.message)) {
          return res.status(404).json({ error: error.message });
        }
        throw error;
      }
    } catch (e) { next(e); }
  });

  return router;
}

export default createAgentMetaRouter;
