import crypto from 'crypto';

/**
 * Translates OpenAI /v1/chat/completions wire format to/from an
 * IChatCompletionRunner.
 *
 * - Non-stream: returns a single chat.completion envelope.
 * - Stream: writes SSE chunks (chat.completion.chunk) ending with [DONE].
 */
export class OpenAIChatCompletionsTranslator {
  #runner;
  #logger;

  constructor({ runner, logger = console }) {
    if (!runner?.runChat) throw new Error('OpenAIChatCompletionsTranslator: runner with runChat required');
    this.#runner = runner;
    this.#logger = logger;
  }

  async handle(req, res, satellite) {
    const start = Date.now();
    const body = req.body ?? {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = !!body.stream;
    const conversationId = body.conversation_id ?? body.conversationId ?? null;
    const model = body.model ?? 'daylight-house';

    this.#logger.info?.('brain.request.received', {
      satellite_id: satellite.id,
      conv_id: conversationId,
      stream,
      msg_count: messages.length,
    });

    if (messages.length === 0) {
      return this.#errorJson(res, 400, 'invalid_request_error', 'messages required', 'bad_request');
    }

    if (stream) {
      return this.#stream(req, res, satellite, { messages, conversationId, model, start });
    }

    try {
      const result = await this.#runner.runChat({
        satellite,
        messages,
        tools: body.tools ?? [],
        conversationId,
      });
      const envelope = this.#buildEnvelope(result, model);
      res.status(200).json(envelope);
      this.#logger.info?.('brain.response.sent', {
        satellite_id: satellite.id,
        status: 200,
        total_latency_ms: Date.now() - start,
        stream: false,
      });
    } catch (error) {
      this.#logger.error?.('brain.runtime.error', { satellite_id: satellite.id, error: error.message });
      this.#errorJson(res, 502, 'server_error', error.message, 'upstream_unavailable');
    }
  }

  async #stream(_req, res, satellite, { messages, conversationId, model, start }) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const send = (chunk) => res.write(`data: ${JSON.stringify(chunk)}\n\n`);

    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant' } }],
    });
    this.#logger.info?.('brain.stream.start', { satellite_id: satellite.id });

    let chunksSent = 0;
    let finishReason = 'stop';
    try {
      for await (const part of this.#runner.streamChat({ satellite, messages, conversationId })) {
        if (part.type === 'text-delta' && part.text) {
          send({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: part.text } }],
          });
          chunksSent++;
        } else if (part.type === 'finish') {
          finishReason = part.reason ?? 'stop';
        }
        // tool-start / tool-end intentionally NOT emitted to client (Spec §7.2)
      }
    } catch (error) {
      this.#logger.error?.('brain.stream.error', {
        satellite_id: satellite.id,
        error: error.message,
        where: 'mid_stream',
      });
      send({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { content: ` (error: ${error.message})` }, finish_reason: 'error' }],
      });
    }

    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
    });
    res.write('data: [DONE]\n\n');
    res.end();

    this.#logger.info?.('brain.stream.complete', {
      satellite_id: satellite.id,
      total_chunks: chunksSent,
      latencyMs: Date.now() - start,
    });
    this.#logger.info?.('brain.response.sent', {
      satellite_id: satellite.id,
      status: 200,
      total_latency_ms: Date.now() - start,
      stream: true,
    });
  }

  #buildEnvelope({ content, toolCalls = [], usage = null }, model) {
    return {
      id: `chatcmpl-${crypto.randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content ?? '',
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: 'stop',
      }],
      usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }

  #errorJson(res, status, type, message, code) {
    res.status(status).json({ error: { message, type, code } });
  }
}

export default OpenAIChatCompletionsTranslator;
