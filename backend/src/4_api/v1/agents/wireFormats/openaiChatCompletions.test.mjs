// backend/src/4_api/v1/agents/wireFormats/openaiChatCompletions.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import openaiWire from './openaiChatCompletions.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

function fakeRes() {
  const writes = []; const headers = {}; let status = 200; let ended = false;
  let closeHandler = null;
  const r = {
    setHeader(h, v) { headers[h] = v; return r; },
    status(s) { status = s; return r; },
    json(b) { r._jsonBody = b; return r; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    on(event, fn) { if (event === 'close') closeHandler = fn; return r; },
    _state: () => ({ status, headers, writes, ended, jsonBody: r._jsonBody }),
    _triggerClose: () => { if (closeHandler) closeHandler(); },
  };
  return r;
}

function redact(blob) {
  return blob
    .replace(/"id":"chatcmpl-[^"]+"/g, '"id":"chatcmpl-{UUID}"')
    .replace(/"created":\d+/g, '"created":{TS}');
}

describe('openaiWire.parseRequest', () => {
  it('extracts messages, model, stream, conversation_id', () => {
    const req = {
      body: {
        model: 'daylight-house', stream: true,
        messages: [{ role: 'user', content: 'hi' }],
        conversation_id: 'conv-1',
      },
    };
    const parsed = openaiWire.parseRequest(req);
    expect(parsed.input).toEqual([{ role: 'user', content: 'hi' }]);
    expect(parsed.context.model).toBe('daylight-house');
    expect(parsed.context.stream).toBe(true);
    expect(parsed.context.conversationId).toBe('conv-1');
  });
});

describe('openaiWire.respondSync', () => {
  it('builds chat.completion envelope', () => {
    const res = fakeRes();
    openaiWire.respondSync(res, {
      output: 'Hi.',
      toolCalls: [],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    }, { model: 'daylight-house' });
    const { jsonBody } = res._state();
    expect(jsonBody.object).toBe('chat.completion');
    expect(jsonBody.choices[0].message.content).toBe('Hi.');
    expect(jsonBody.choices[0].finish_reason).toBe('stop');
    expect(jsonBody.usage).toEqual({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 });
  });
});

describe('openaiWire.respondStream — golden master', () => {
  it('matches the captured baseline byte-for-byte (after redaction)', async () => {
    const expected = readFileSync(
      join(process.cwd(), 'tests/isolated/api/agents/_baselines/openai-chat-completions-sse.txt'),
      'utf8',
    );
    async function* gen() {
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'tool-start', toolName: 'remember_note', args: { text: 'pizza tonight' } };
      yield { type: 'tool-end', toolName: 'remember_note', result: { ok: true } };
      yield { type: 'text-delta', text: ' from' };
      yield { type: 'text-delta', text: ' the kitchen.' };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house', logger: silentLogger });
    const blob = redact(res._state().writes.join(''));
    expect(blob).toBe(expected);
  });
});

describe('openaiWire.respondStream — invariants', () => {
  it('sets X-Accel-Buffering: no', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    expect(res._state().headers['X-Accel-Buffering']).toBe('no');
  });

  it('does NOT emit tool-start / tool-end to the wire', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'hi' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    const blob = res._state().writes.join('');
    expect(blob).not.toMatch(/tool-start|tool-end|tool_start|tool_end/);
  });

  it('terminates with data: [DONE]\\n\\n', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    const blob = res._state().writes.join('');
    expect(blob.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('mid-stream error emits content delta with finish_reason: error and still ends with [DONE]', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('upstream broke');
    }
    const res = fakeRes();
    await openaiWire.respondStream(res, gen(), { model: 'daylight-house', logger: silentLogger });
    const blob = res._state().writes.join('');
    expect(blob).toMatch(/upstream broke/);
    expect(blob).toMatch(/"finish_reason":"error"/);
    expect(blob.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('stops iterating when client closes connection', async () => {
    let yielded = 0;
    async function* gen() {
      while (true) {
        yielded++;
        yield { type: 'text-delta', text: '.' };
        await new Promise((r) => setTimeout(r, 5));
        if (yielded > 100) throw new Error('iterator should have been stopped by close');
      }
    }
    const res = fakeRes();
    const promise = openaiWire.respondStream(res, gen(), { model: 'daylight-house' });
    await new Promise((r) => setTimeout(r, 15));
    res._triggerClose();
    await promise;
    expect(yielded).toBeLessThan(100);
  });
});

describe('openaiWire.respondError', () => {
  it('400 for bad request', () => {
    const res = fakeRes();
    openaiWire.respondError(res, new Error('messages required'), { isPreflight: true });
    const { status, jsonBody } = res._state();
    expect(status).toBe(400);
    expect(jsonBody.error.code).toBe('bad_request');
  });

  it('502 for upstream errors', () => {
    const res = fakeRes();
    openaiWire.respondError(res, new Error('mastra failed'));
    const { status, jsonBody } = res._state();
    expect(status).toBe(502);
    expect(jsonBody.error.code).toBe('upstream_unavailable');
  });
});
