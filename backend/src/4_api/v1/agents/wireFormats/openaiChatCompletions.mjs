// backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.mjs
import crypto from 'node:crypto';

/**
 * OpenAI Chat Completions wire format preset.
 *
 * Mirrors the legacy OpenAIChatCompletionsTranslator byte-for-byte:
 *   - Non-stream: returns a single chat.completion envelope
 *   - Stream: writes SSE chunks (chat.completion.chunk) ending with data: [DONE]
 *   - tool-start / tool-end events are suppressed on the wire (HA Voice Spec §7.2)
 *   - X-Accel-Buffering: no header is set for nginx pass-through
 */

export function parseRequest(req) {
  const body = req?.body ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return {
    input: messages,
    context: {
      model: body.model ?? 'daylight-house',
      stream: !!body.stream,
      conversationId: body.conversation_id ?? body.conversationId ?? null,
      tools: body.tools ?? [],
    },
  };
}

export function respondSync(res, result, { model = 'daylight-house' } = {}) {
  const envelope = buildEnvelope(result, model);
  res.status(200).json(envelope);
}

export async function respondStream(res, asyncIter, { model = 'daylight-house', logger } = {}) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const send = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

  let closed = false;
  res.on('close', () => { closed = true; });

  // Initial role chunk — mirrors legacy translator exactly
  send({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' } }],
  });

  let finishReason = 'stop';
  let streamError = null;

  try {
    for await (const part of asyncIter) {
      if (closed) break;
      if (part.type === 'text-delta' && part.text) {
        send({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: part.text } }],
        });
      } else if (part.type === 'finish') {
        finishReason = part.reason ?? 'stop';
      }
      // 'tool-start' / 'tool-end' intentionally NOT emitted to client (HA Voice Spec §7.2)
    }
  } catch (error) {
    streamError = error;
    logger?.error?.('agents.openai.stream.error', { error: error.message });
    if (!closed) {
      send({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: ` (error: ${error.message})` }, finish_reason: 'error' }],
      });
    }
  }

  // Final finish chunk — always emitted (mirrors legacy translator)
  if (!closed) {
    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: streamError ? finishReason : finishReason }],
    });
    res.write('data: [DONE]\n\n');
  }

  res.end();
}

export function respondError(res, err, { isPreflight = false } = {}) {
  const message = err?.message ?? String(err);
  if (isPreflight || /messages required|invalid_request/i.test(message)) {
    return res.status(400).json({ error: { message, type: 'invalid_request_error', code: 'bad_request' } });
  }
  return res.status(502).json({ error: { message, type: 'server_error', code: 'upstream_unavailable' } });
}

function buildEnvelope(result, model) {
  const content = result?.content ?? result?.output ?? '';
  const toolCalls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
  const usage = result?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      finish_reason: 'stop',
    }],
    usage,
  };
}

export default {
  name: 'openai-chat-completions',
  parseRequest,
  respondSync,
  respondStream,
  respondError,
};
