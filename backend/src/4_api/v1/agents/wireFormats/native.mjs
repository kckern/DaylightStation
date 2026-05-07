// backend/src/4_api/v1/agents/wireFormats/native.mjs

/**
 * Native wire format — JSON in, JSON out for /run, raw orchestrator chunks
 * over SSE for /run-stream. Mirrors the legacy agents.mjs + agents-stream.mjs
 * behavior byte-for-byte.
 */

const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const MAX_MESSAGES = 20;

function extractContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('');
  }
  return null;
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    if (!VALID_ROLES.has(m.role)) continue;
    const text = extractContentText(m.content);
    if (typeof text !== 'string') continue;
    out.push({ role: m.role, content: text });
  }
  // Cap to last MAX_MESSAGES
  return out.length > MAX_MESSAGES ? out.slice(out.length - MAX_MESSAGES) : out;
}

export function parseRequest(req) {
  const body = req?.body || {};
  const input = body.input ?? null;
  let messages = sanitizeMessages(body.messages);
  if (messages.length === 0 && typeof input === 'string' && input.length > 0) {
    messages = [{ role: 'user', content: input }];
  }

  // threadId: prefer body root, fall back to body.context, must be non-empty string
  let threadId = null;
  if (typeof body.threadId === 'string' && body.threadId.length > 0) {
    threadId = body.threadId;
  } else if (typeof body.context?.threadId === 'string' && body.context.threadId.length > 0) {
    threadId = body.context.threadId;
  }

  return {
    input,
    context: body.context ?? {},
    messages,
    threadId,
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
