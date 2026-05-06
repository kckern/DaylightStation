import crypto from 'crypto';
import { AgentTranscript } from '../../../3_applications/agents/framework/AgentTranscript.mjs';

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
  #mediaLogsDir;

  constructor({ runner, logger = console, mediaLogsDir = null }) {
    if (!runner?.runChat) throw new Error('OpenAIChatCompletionsTranslator: runner with runChat required');
    this.#runner = runner;
    this.#logger = logger;
    this.#mediaLogsDir = mediaLogsDir;
  }

  /**
   * Build an AgentTranscript for a concierge request.
   *
   * filePathStrategy preserves the original ConciergeTranscript layout:
   *   {mediaDir}/concierge/{YYYY-MM-DD}/{satelliteId}/{ts}-{turnId}.json
   */
  #makeTranscript({ satellite, model, stream, conversationId, messages }) {
    const satId = satellite?.id ?? 'unknown';
    return new AgentTranscript({
      agentId: 'concierge',
      userId: 'household',
      mediaDir: this.#mediaLogsDir,
      logger: this.#logger,
      input: {
        text: messages.filter(m => m.role === 'user').at(-1)?.content ?? '',
        context: { messages },
      },
      filePathStrategy: (t) => {
        const day = new Date(t.startedAt).toISOString().slice(0, 10);
        const ts = new Date(t.startedAt).toISOString().replace(/[:.]/g, '-');
        return `${t.mediaDir}/concierge/${day}/${satId}/${ts}-${t.turnId}.json`;
      },
    });
  }

  async handle(req, res, satellite) {
    const start = Date.now();
    const body = req.body ?? {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const stream = !!body.stream;
    const conversationId = body.conversation_id ?? body.conversationId ?? null;
    const model = body.model ?? 'daylight-house';

    this.#logger.info?.('concierge.request.received', {
      satellite_id: satellite.id,
      conv_id: conversationId,
      stream,
      msg_count: messages.length,
    });

    if (messages.length === 0) {
      return this.#errorJson(res, 400, 'invalid_request_error', 'messages required', 'bad_request');
    }

    const transcript = this.#makeTranscript({ satellite, model, stream, conversationId, messages });
    transcript.setSatelliteSnapshot({
      id: satellite.id,
      area: satellite.area,
      allowedSkills: satellite.allowedSkills,
    });
    transcript.setRequestBody({ model, stream, conversation_id: conversationId, messages });

    if (stream) {
      return this.#stream(req, res, satellite, { messages, conversationId, model, start, transcript });
    }

    try {
      const result = await this.#runner.runChat({
        satellite,
        messages,
        tools: body.tools ?? [],
        conversationId,
        transcript,
      });
      transcript.setOutput({ text: result.content ?? '', finishReason: 'stop', usage: result.usage });
      transcript.setStatus('ok');
      const envelope = this.#buildEnvelope(result, model);
      res.status(200).json(envelope);
      this.#logger.info?.('concierge.response.sent', {
        satellite_id: satellite.id,
        status: 200,
        total_latency_ms: Date.now() - start,
        stream: false,
      });
      await transcript.flush();
    } catch (error) {
      this.#logger.error?.('concierge.runtime.error', { satellite_id: satellite.id, error: error.message });
      transcript.setError(error);
      transcript.setStatus('error');
      this.#errorJson(res, 502, 'server_error', error.message, 'upstream_unavailable');
      await transcript.flush();
    }
  }

  async #stream(_req, res, satellite, { messages, conversationId, model, start, transcript }) {
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
    this.#logger.info?.('concierge.stream.start', { satellite_id: satellite.id });

    let chunksSent = 0;
    let finishReason = 'stop';
    let assistantText = '';
    let streamError = null;
    try {
      for await (const part of this.#runner.streamChat({ satellite, messages, conversationId, transcript })) {
        if (part.type === 'text-delta' && part.text) {
          send({
            id,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{ index: 0, delta: { content: part.text } }],
          });
          assistantText += part.text;
          chunksSent++;
        } else if (part.type === 'finish') {
          finishReason = part.reason ?? 'stop';
        }
        // tool-start / tool-end intentionally NOT emitted to client (Spec §7.2)
      }
    } catch (error) {
      streamError = error;
      this.#logger.error?.('concierge.stream.error', {
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
      transcript?.setError(error);
      transcript?.setStatus('error');
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

    if (transcript && !streamError) {
      transcript.setOutput({ text: assistantText, finishReason });
      transcript.setStatus('ok');
    }
    await transcript?.flush();

    this.#logger.info?.('concierge.stream.complete', {
      satellite_id: satellite.id,
      total_chunks: chunksSent,
      latencyMs: Date.now() - start,
    });
    this.#logger.info?.('concierge.response.sent', {
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
