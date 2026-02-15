// backend/src/4_api/routers/agents.mjs

/**
 * Agents API Router
 *
 * Endpoints:
 * - GET  /api/agents - List available agents
 * - POST /api/agents/:agentId/run - Run an agent synchronously
 * - POST /api/agents/:agentId/run-background - Run an agent in background
 * - GET  /api/agents/:agentId/assignments - List agent assignments
 * - POST /api/agents/:agentId/assignments/:assignmentId/run - Trigger assignment
 * - GET    /api/agents/:agentId/memory/:userId - Read working memory
 * - DELETE /api/agents/:agentId/memory/:userId - Clear all working memory
 * - DELETE /api/agents/:agentId/memory/:userId/:key - Delete single memory entry
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create agents API router
 *
 * @param {Object} config
 * @param {Object} config.agentOrchestrator - AgentOrchestrator instance
 * @param {Object} [config.workingMemory] - Working memory adapter (load/save)
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAgentsRouter(config) {
  const router = express.Router();
  const { agentOrchestrator, workingMemory, logger = console } = config;

  if (!agentOrchestrator) {
    throw new Error('agentOrchestrator is required');
  }

  /**
   * GET /api/agents
   * List all registered agents
   */
  router.get('/', asyncHandler(async (req, res) => {
    const agents = agentOrchestrator.list();
    res.json({ agents });
  }));

  /**
   * POST /api/agents/:agentId/run
   * Run an agent synchronously
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run', asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    logger.info?.('agents.run.request', { agentId, inputLength: input.length });

    try {
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

      throw error;
    }
  }));

  /**
   * POST /api/agents/:agentId/run-background
   * Run an agent in background (returns immediately)
   * Body: { input: string, context?: object }
   */
  router.post('/:agentId/run-background', asyncHandler(async (req, res) => {
    const { agentId } = req.params;
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'input is required' });
    }

    logger.info?.('agents.runBackground.request', { agentId });

    try {
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

      throw error;
    }
  }));

  /**
   * GET /api/agents/:agentId/assignments
   * List assignments for an agent
   */
  router.get('/:agentId/assignments', asyncHandler(async (req, res) => {
    const { agentId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    const instances = agentOrchestrator.listInstances();
    const agent = instances.find(a => a.constructor.id === agentId);
    const assignments = (agent?.getAssignments?.() || []).map(a => ({
      id: a.constructor.id,
      description: a.constructor.description || '',
      schedule: a.constructor.schedule || null,
    }));

    res.json({ agentId, assignments });
  }));

  /**
   * POST /api/agents/:agentId/assignments/:assignmentId/run
   * Manually trigger an assignment
   * Body: { userId?: string, context?: object }
   */
  router.post('/:agentId/assignments/:assignmentId/run', asyncHandler(async (req, res) => {
    const { agentId, assignmentId } = req.params;
    const { userId, context = {} } = req.body;

    logger.info?.('agents.runAssignment.request', { agentId, assignmentId, userId });

    try {
      const result = await agentOrchestrator.runAssignment(agentId, assignmentId, {
        userId,
        context,
        triggeredBy: 'api',
      });

      res.json({ agentId, assignmentId, status: 'complete', result });
    } catch (error) {
      logger.error?.('agents.runAssignment.error', { agentId, assignmentId, error: error.message });

      if (error.message.includes('not found') || error.message.includes('Unknown assignment')) {
        return res.status(404).json({ error: error.message });
      }

      throw error;
    }
  }));

  // --- Working Memory endpoints ---

  /**
   * GET /api/agents/:agentId/memory/:userId
   * Read all working memory entries for an agent + user
   */
  router.get('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const state = await workingMemory.load(agentId, userId);
    const entries = state.toJSON();

    logger.info?.('agents.memory.read', { agentId, userId, count: Object.keys(entries).length });
    res.json({ agentId, userId, entries });
  }));

  /**
   * DELETE /api/agents/:agentId/memory/:userId
   * Clear all working memory for an agent + user
   */
  router.delete('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const { WorkingMemoryState } = await import('#apps/agents/framework/WorkingMemory.mjs');
    await workingMemory.save(agentId, userId, new WorkingMemoryState());

    logger.info?.('agents.memory.cleared', { agentId, userId });
    res.json({ agentId, userId, cleared: true });
  }));

  /**
   * DELETE /api/agents/:agentId/memory/:userId/:key
   * Delete a single working memory entry
   */
  router.delete('/:agentId/memory/:userId/:key', asyncHandler(async (req, res) => {
    const { agentId, userId, key } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const state = await workingMemory.load(agentId, userId);
    const existed = state.get(key) !== undefined;
    state.remove(key);
    await workingMemory.save(agentId, userId, state);

    logger.info?.('agents.memory.entry.deleted', { agentId, userId, key });
    res.json({ agentId, userId, key, deleted: existed });
  }));

  return router;
}

export default createAgentsRouter;
