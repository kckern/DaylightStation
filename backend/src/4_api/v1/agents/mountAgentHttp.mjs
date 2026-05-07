// backend/src/4_api/v1/agents/mountAgentHttp.mjs

import express from 'express';
import nativeWire from './wireFormats/native.mjs';
import openaiWire from './wireFormats/openaiChatCompletions.mjs';

const WIRE_FORMATS = {
  native: nativeWire,
  'openai-chat-completions': openaiWire,
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
    advertisedModels = null,
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

  if (wireFormat === 'openai-chat-completions') {
    mountOpenAI({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, advertisedModels, logger });
    return;
  }

  throw new Error(`mountAgentHttp: wireFormat '${wireFormat}' not yet implemented`);
}

function mountNative({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, logger }) {
  const router = express.Router();
  for (const mw of authMiddleware) router.use(mw);

  router.post(`/${agentId}/run`, async (req, res) => {
    try {
      const { input, context, messages, threadId } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = { ...mergeContext(context, contextExtractor, req), messages, threadId };
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
      const { input, context, messages, threadId } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = { ...mergeContext(context, contextExtractor, req), messages, threadId };
      const iter = orchestrator.streamExecute(agentId, input, merged);
      await wire.respondStream(res, iter, { agentId, logger });
    } catch (err) {
      logger.error?.('agents.runStream.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.post(`/${agentId}/run-background`, async (req, res) => {
    try {
      const { input, context, messages, threadId } = wire.parseRequest(req);
      if (!input) return wire.respondError(res, new Error('input is required'));
      const merged = { ...mergeContext(context, contextExtractor, req), messages, threadId };
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

function mountOpenAI({ app, mountPath, agentId, orchestrator, wire, authMiddleware, contextExtractor, advertisedModels, logger }) {
  const router = express.Router();
  for (const mw of authMiddleware) router.use(mw);

  router.post('/chat/completions', async (req, res) => {
    let parsed;
    try {
      parsed = wire.parseRequest(req);
    } catch (err) {
      return wire.respondError(res, err, { isPreflight: true });
    }
    const { input: messages, context: wireContext } = parsed;
    if (!messages || messages.length === 0) {
      return wire.respondError(res, new Error('messages required'), { isPreflight: true });
    }
    const merged = mergeContext(wireContext, contextExtractor, req);

    if (wireContext.stream) {
      try {
        const iter = orchestrator.streamExecute(agentId, messages, merged);
        await wire.respondStream(res, iter, { model: wireContext.model, logger });
      } catch (err) {
        wire.respondError(res, err);
      }
      return;
    }

    try {
      logger.info?.('agents.openai.run.request', { agentId, model: wireContext.model });
      const result = await orchestrator.run(agentId, messages, merged);
      wire.respondSync(res, result, { model: wireContext.model });
    } catch (err) {
      logger.error?.('agents.openai.run.error', { agentId, error: err.message });
      wire.respondError(res, err);
    }
  });

  router.get('/models', (_req, res) => {
    const models = advertisedModels ?? ['daylight-house', 'gpt-4o-mini'];
    const created = Math.floor(Date.now() / 1000);
    res.status(200).json({
      object: 'list',
      data: models.map((id) => ({ id, object: 'model', created, owned_by: 'daylight' })),
    });
  });

  app.use(mountPath, router);
  logger.info?.('agents.http.mounted', { agentId, mountPath, wireFormat: 'openai-chat-completions' });
}

function mergeContext(bodyContext, contextExtractor, req) {
  const extracted = contextExtractor ? contextExtractor(req) : null;
  return { ...(bodyContext || {}), ...(extracted || {}) };
}

export default mountAgentHttp;
