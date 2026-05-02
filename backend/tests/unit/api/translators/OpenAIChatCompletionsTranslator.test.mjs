import { describe, it } from 'node:test';
import assert from 'node:assert';
import { OpenAIChatCompletionsTranslator } from '../../../../src/4_api/v1/translators/OpenAIChatCompletionsTranslator.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeRunner {
  constructor(out) { this.out = out; this.calls = []; }
  async runChat(opts) { this.calls.push(opts); return this.out; }
  async *streamChat() {}
}

class FakeStreamingRunner {
  constructor(chunks) { this.chunks = chunks; }
  async runChat() { return { content: '', toolCalls: [], usage: null }; }
  async *streamChat() { for (const c of this.chunks) yield c; }
}

class FakeErrorStreamingRunner {
  async runChat() { return { content: '', toolCalls: [], usage: null }; }
  async *streamChat() {
    yield { type: 'text-delta', text: 'partial' };
    throw new Error('upstream broke');
  }
}

function fakeRes() {
  const headers = {};
  let status = 200;
  let body = null;
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    set(h, v) { headers[h] = v; return this; },
    status(s) { status = s; return this; },
    json(b) { body = b; return this; },
    _state: () => ({ headers, status, body }),
  };
}

function streamingFakeRes() {
  const writes = [];
  let status = 200;
  let ended = false;
  const headers = {};
  return {
    setHeader(h, v) { headers[h] = v; return this; },
    set(h, v) { headers[h] = v; return this; },
    status(s) { status = s; return this; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    _state: () => ({ status, headers, writes, ended }),
  };
}

describe('OpenAIChatCompletionsTranslator (non-stream)', () => {
  it('returns OpenAI envelope on success', async () => {
    const runner = new FakeRunner({
      content: 'Hi.',
      toolCalls: [],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
    });
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: silentLogger });
    const req = { body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: false } };
    const res = fakeRes();
    await tx.handle(req, res, { id: 's', allowedSkills: ['memory'] });
    const { status, body } = res._state();
    assert.strictEqual(status, 200);
    assert.strictEqual(body.object, 'chat.completion');
    assert.strictEqual(body.choices[0].message.content, 'Hi.');
    assert.strictEqual(body.choices[0].finish_reason, 'stop');
  });

  it('400 when messages missing', async () => {
    const runner = new FakeRunner({ content: 'x', toolCalls: [], usage: null });
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: silentLogger });
    const res = fakeRes();
    await tx.handle({ body: { stream: false } }, res, { id: 's', allowedSkills: ['memory'] });
    const { status, body } = res._state();
    assert.strictEqual(status, 400);
    assert.strictEqual(body.error.code, 'bad_request');
  });

  it('502 when runner throws', async () => {
    const runner = {
      async runChat() { throw new Error('boom'); },
      async *streamChat() {},
    };
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: silentLogger });
    const res = fakeRes();
    await tx.handle(
      { body: { messages: [{ role: 'user', content: 'hi' }], stream: false } },
      res,
      { id: 's', allowedSkills: ['memory'] },
    );
    const { status, body } = res._state();
    assert.strictEqual(status, 502);
    assert.strictEqual(body.error.code, 'upstream_unavailable');
  });
});

describe('OpenAIChatCompletionsTranslator (stream)', () => {
  it('emits SSE chunks ending with [DONE]', async () => {
    const runner = new FakeStreamingRunner([
      { type: 'text-delta', text: 'Hi' },
      { type: 'text-delta', text: ' there' },
      { type: 'finish', reason: 'stop' },
    ]);
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: silentLogger });
    const req = { body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], stream: true } };
    const res = streamingFakeRes();
    await tx.handle(req, res, { id: 's', allowedSkills: ['memory'] });
    const { writes, ended, headers } = res._state();
    assert.strictEqual(headers['Content-Type'], 'text/event-stream');
    const blob = writes.join('');
    assert.match(blob, /"delta":\{"role":"assistant"\}/);
    assert.match(blob, /"delta":\{"content":"Hi"\}/);
    assert.match(blob, /"delta":\{"content":" there"\}/);
    assert.match(blob, /"finish_reason":"stop"/);
    assert.match(blob, /data: \[DONE\]\n\n$/);
    assert.strictEqual(ended, true);
  });

  it('mid-stream error emits an error chunk and still ends with [DONE]', async () => {
    const runner = new FakeErrorStreamingRunner();
    const tx = new OpenAIChatCompletionsTranslator({ runner, logger: silentLogger });
    const req = { body: { messages: [{ role: 'user', content: 'hi' }], stream: true } };
    const res = streamingFakeRes();
    await tx.handle(req, res, { id: 's', allowedSkills: ['memory'] });
    const { writes, ended } = res._state();
    const blob = writes.join('');
    assert.match(blob, /"content":"partial"/);
    assert.match(blob, /upstream broke/);
    assert.match(blob, /data: \[DONE\]\n\n$/);
    assert.strictEqual(ended, true);
  });
});
