// backend/src/4_api/v1/agents/createAgentMemoryRouter.mjs
import express from 'express';
import { WorkingMemoryState } from '#apps/agents/framework/WorkingMemory.mjs';

/**
 * Memory CRUD endpoints — admin/debug surface for inspecting and clearing
 * agent working memory. Agent-agnostic; mounted ONCE at /api/v1/agents.
 *
 * Routes:
 *   GET    /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId
 *   DELETE /:agentId/memory/:userId/:key
 */
export function createAgentMemoryRouter({ orchestrator, workingMemory, logger = console } = {}) {
  if (!orchestrator) throw new Error('createAgentMemoryRouter: orchestrator required');
  if (!workingMemory) throw new Error('createAgentMemoryRouter: workingMemory required');

  const router = express.Router();

  /**
   * GET /:agentId/memory/:userId
   * Read all working memory entries for an agent + user
   */
  router.get('/:agentId/memory/:userId', async (req, res, next) => {
    try {
      const { agentId, userId } = req.params;
      if (!orchestrator.has(agentId)) {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      const state = await workingMemory.load(agentId, userId);
      const entries = state.toJSON();
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
      if (!orchestrator.has(agentId)) {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      await workingMemory.save(agentId, userId, new WorkingMemoryState());
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
      if (!orchestrator.has(agentId)) {
        return res.status(404).json({ error: `Agent '${agentId}' not found` });
      }
      const state = await workingMemory.load(agentId, userId);
      const existed = state.get(key) !== undefined;
      state.remove(key);
      await workingMemory.save(agentId, userId, state);
      logger.info?.('agents.memory.entry.deleted', { agentId, userId, key });
      res.json({ agentId, userId, key, deleted: existed });
    } catch (err) { next(err); }
  });

  return router;
}

export default createAgentMemoryRouter;
