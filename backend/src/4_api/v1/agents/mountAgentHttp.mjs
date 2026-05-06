// backend/src/4_api/v1/agents/mountAgentHttp.mjs

import express from 'express';
import nativeWire from './wireFormats/native.mjs';

const WIRE_FORMATS = {
  native: nativeWire,
  // 'openai-chat-completions' added in Task 7
};

/**
 * Mount an agent's HTTP surface onto an Express app.
 *
 * @param {express.Application} app
 * @param {Object} opts
 * @param {Object}        opts.orchestrator       — AgentOrchestrator instance
 * @param {string}        opts.agentId            — registered agent id
 * @param {string}        opts.mountPath          — e.g. '/api/v1/agents'
 * @param {string}        opts.wireFormat         — 'native' | 'openai-chat-completions'
 * @param {Function[]}    [opts.authMiddleware]   — array of express middleware
 * @param {Function}      [opts.contextExtractor] — (req) => partial-context merged into orchestrator context
 * @param {Object}        [opts.logger]
 * @returns {void}
 */
export function mountAgentHttp(app, opts) {
  const {
    orchestrator,
    agentId,
    mountPath,
    wireFormat,
    authMiddleware = [],
    contextExtractor = null,
    logger = console,
  } = opts;

  if (!orchestrator) throw new Error('mountAgentHttp: orchestrator required');
  if (!agentId) throw new Error('mountAgentHttp: agentId required');
  if (!mountPath) throw new Error('mountAgentHttp: mountPath required');

  const wire = WIRE_FORMATS[wireFormat];
  if (!wire) throw new Error(`mountAgentHttp: unknown wireFormat '${wireFormat}'`);

  if (wireFormat === 'native') {
    mountNative({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger });
    return;
  }

  throw new Error(`mountAgentHttp: wireFormat '${wireFormat}' not yet implemented`);
}

function mountNative({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger }) {
  const router = express.Router();
  for (const mw of authMiddleware) router.use(mw);

  router.post(`/${agentId}/run`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      logger.info?.('agents.run.request', { agentId, inputLength: input.length });
      const result = await orchestrator.run(agentId, input, merged);
      wire.respondSync(res, result, { agentId });
    } catch (err) {
      logger.error?.('agents.run.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.post(`/${agentId}/run-stream`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      const iter = orchestrator.streamExecute(agentId, input, merged);
      await wire.respondStream(res, iter, { agentId, logger });
    } catch (err) {
      logger.error?.('agents.runStream.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.post(`/${agentId}/run-background`, async (req, res) => {
    try {
      const { input, context } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = mergeContext(context, contextExtractor, req);
      logger.info?.('agents.runBackground.request', { agentId });
      const { taskId } = await orchestrator.runInBackground(agentId, input, merged);
      res.status(202).json({ agentId, taskId, status: 'accepted' });
    } catch (err) {
      logger.error?.('agents.runBackground.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  app.use(mountPath, router);
  logger.info?.('agents.http.mounted', { agentId, mountPath, wireFormat: 'native' });
}

function mergeContext(bodyContext, contextExtractor, req) {
  const extracted = contextExtractor ? contextExtractor(req) : null;
  return { ...(bodyContext || {}), ...(extracted || {}) };
}

export default mountAgentHttp;
