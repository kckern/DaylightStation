// backend/src/4_api/v1/agents/wireFormats/native.mjs

/**
 * Native wire format — JSON in, JSON out for /run, raw orchestrator chunks
 * over SSE for /run-stream. Mirrors the legacy agents.mjs + agents-stream.mjs
 * behavior byte-for-byte.
 */

export function parseRequest(req) {
  const body = req?.body || {};
  return {
    input: body.input ?? null,
    context: body.context ?? {},
  };
}

export function respondSync(res, result, { agentId } = {}) {
  res.json({
    agentId,
    output: result?.output,
    toolCalls: result?.toolCalls ?? [],
  });
}

export async function respondStream(res, asyncIter, { agentId, logger } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => { closed = true; });

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    logger?.info?.('agents.runStream.start', { agentId });
    for await (const chunk of asyncIter) {
      if (closed) break;
      send(chunk);
    }
    if (!closed) send({ type: 'done' });
    res.end();
    logger?.info?.('agents.runStream.complete', { agentId });
  } catch (err) {
    logger?.error?.('agents.runStream.error', { agentId, error: err.message });
    if (!closed) send({ type: 'error', message: err.message });
    res.end();
  }
}

export function respondError(res, err) {
  const msg = err?.message ?? String(err);
  if (/input is required/i.test(msg)) return res.status(400).json({ error: msg });
  if (/not found/i.test(msg)) return res.status(404).json({ error: msg });
  return res.status(500).json({ error: msg });
}

export default {
  name: 'native',
  parseRequest,
  respondSync,
  respondStream,
  respondError,
};
