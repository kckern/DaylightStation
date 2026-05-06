// backend/src/4_api/v1/agents/wireFormats/native.test.mjs
import { describe, it, expect, vi } from 'vitest';
import nativeWire from './native.mjs';

function fakeRes() {
  const writes = [];
  const headers = {};
  let status = 200;
  let ended = false;
  let closeHandler = null;
  const r = {
    setHeader(h, v) { headers[h] = v; return r; },
    status(s) { status = s; return r; },
    json(b) { r._jsonBody = b; return r; },
    write(d) { writes.push(d); return true; },
    end() { ended = true; },
    flushHeaders() {},
    on(event, fn) { if (event === 'close') closeHandler = fn; return r; },
    _state: () => ({ status, headers, writes, ended, jsonBody: r._jsonBody, closeHandler }),
    _triggerClose: () => { if (closeHandler) closeHandler(); },
  };
  return r;
}

describe('nativeWire.parseRequest', () => {
  it('extracts input and context from JSON body', () => {
    const req = { body: { input: 'hello', context: { userId: 'kc' } } };
    expect(nativeWire.parseRequest(req)).toEqual({ input: 'hello', context: { userId: 'kc' } });
  });

  it('defaults context to {} when missing', () => {
    const req = { body: { input: 'hi' } };
    expect(nativeWire.parseRequest(req)).toEqual({ input: 'hi', context: {} });
  });

  it('returns input=null when body is empty', () => {
    expect(nativeWire.parseRequest({}).input).toBe(null);
  });
});

describe('nativeWire.respondSync', () => {
  it('writes JSON envelope with agentId, output, toolCalls', () => {
    const res = fakeRes();
    nativeWire.respondSync(res, { output: 'hi', toolCalls: [{ name: 't', args: {} }] }, { agentId: 'echo' });
    const { jsonBody } = res._state();
    expect(jsonBody).toEqual({ agentId: 'echo', output: 'hi', toolCalls: [{ name: 't', args: {} }] });
  });
});

describe('nativeWire.respondStream', () => {
  it('emits SSE chunks 1:1 followed by done event', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'Hi' };
      yield { type: 'tool-start', toolName: 'foo', args: {} };
      yield { type: 'tool-end', toolName: 'foo', result: { ok: true } };
      yield { type: 'finish', reason: 'stop' };
    }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { writes, ended } = res._state();
    const events = writes.map((w) => JSON.parse(w.replace(/^data: /, '').replace(/\n\n$/, '')));
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'tool-start', 'tool-end', 'finish', 'done']);
    expect(ended).toBe(true);
  });

  it('sets the X-Accel-Buffering: no header (nginx pass-through)', async () => {
    async function* gen() { yield { type: 'finish', reason: 'stop' }; }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { headers } = res._state();
    expect(headers['X-Accel-Buffering']).toBe('no');
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
  });

  it('stops iterating when client disconnects (res.on(close))', async () => {
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
    const promise = nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    await new Promise((r) => setTimeout(r, 15));
    res._triggerClose();
    await promise;
    expect(yielded).toBeLessThan(100);
  });

  it('emits error event when iterator throws', async () => {
    async function* gen() {
      yield { type: 'text-delta', text: 'partial' };
      throw new Error('boom');
    }
    const res = fakeRes();
    await nativeWire.respondStream(res, gen(), { agentId: 'echo' });
    const { writes, ended } = res._state();
    const events = writes.map((w) => JSON.parse(w.replace(/^data: /, '').replace(/\n\n$/, '')));
    expect(events.find((e) => e.type === 'error')).toBeDefined();
    expect(events.find((e) => e.type === 'error').message).toMatch(/boom/);
    expect(ended).toBe(true);
  });
});

describe('nativeWire.respondError', () => {
  it('returns 400 when error message includes "input is required"', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error('input is required'));
    const { status, jsonBody } = res._state();
    expect(status).toBe(400);
    expect(jsonBody.error).toMatch(/input is required/);
  });

  it('returns 404 when error message includes "not found"', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error("Agent 'foo' not found"));
    const { status, jsonBody } = res._state();
    expect(status).toBe(404);
    expect(jsonBody.error).toMatch(/not found/);
  });

  it('returns 500 for generic errors', () => {
    const res = fakeRes();
    nativeWire.respondError(res, new Error('something went wrong'));
    const { status } = res._state();
    expect(status).toBe(500);
  });
});
