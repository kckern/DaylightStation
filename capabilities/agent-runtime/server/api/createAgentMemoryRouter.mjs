// backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs
import express from 'express';

/**
 * Memory CRUD endpoints — admin/debug surface for inspecting and clearing
 * agent working memory. Agent-agnostic; mounted ONCE at /api/v1/agents.
 *
 * Routes:
 *   GET    /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId/:key
 */
export function createAgentMemoryRouter({
  memoryAdministration,
  logger = console,
} = {}) {
  if (!memoryAdministration) throw new Error('createAgentMemoryRouter: memoryAdministration required');

  const router = express.Router();

  /**
   * GET /:agentId/memory/:userId
   * Read all working memory entries for an agent + user
   */
  router.get('/:agentId/memory/:userId', async (req, res, next) => {
    try {
      const { agentId, userId } = req.params;
      const result = await memoryAdministration.read(agentId, userId);
      if (result.kind === 'agent_not_found') {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      const { entries } = result;
      logger.info?.('agents.memory.read', { agentId, userId, count: Object.keys(entries).length });
      res.json({ agentId, userId, entries });
    } catch (err) { next(err); }
  });

  /**
   * DELETE /:agentId/memory/:userId
   * Clear all working memory for an agent + user
   */
  router.delete('/:agentId/memory/:userId', async (req, res, next) => {
    try {
      const { agentId, userId } = req.params;
      const result = await memoryAdministration.clear(agentId, userId);
      if (result.kind === 'agent_not_found') {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      logger.info?.('agents.memory.cleared', { agentId, userId });
      res.json({ agentId, userId, cleared: true });
    } catch (err) { next(err); }
  });

  /**
   * DELETE /:agentId/memory/:userId/:key
   * Delete a single working memory entry
   */
  router.delete('/:agentId/memory/:userId/:key', async (req, res, next) => {
    try {
      const { agentId, userId, key } = req.params;
      const result = await memoryAdministration.remove(agentId, userId, key);
      if (result.kind === 'agent_not_found') {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      logger.info?.('agents.memory.entry.deleted', { agentId, userId, key });
      res.json({ agentId, userId, key, deleted: result.deleted });
    } catch (err) { next(err); }
  });

  return router;
}

export default createAgentMemoryRouter;
