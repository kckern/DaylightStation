import { describe, it, expect } from 'vitest';
import { parseSSE } from './parseSSE.js';

function readableStreamFrom(strings) {
  return new ReadableStream({
    async start(controller) {
      for (const s of strings) controller.enqueue(new TextEncoder().encode(s));
      controller.close();
    },
  });
}

describe('parseSSE', () => {
  it('parses a single complete event', async () => {
    const stream = readableStreamFrom(['data: {"type":"text-delta","text":"hi"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'text-delta', text: 'hi' }]);
  });

  it('parses multiple events split across chunks', async () => {
    const stream = readableStreamFrom([
      'data: {"type":"text-delta","text":"a"}\n\ndata: {"type"',
      ':"text-delta","text":"b"}\n\n',
    ]);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'text-delta', text: 'b' },
    ]);
  });

  it('skips empty/comment lines', async () => {
    const stream = readableStreamFrom([': comment\n\ndata: {"type":"finish"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'finish' }]);
  });

  it('handles partial trailing chunk gracefully', async () => {
    const stream = readableStreamFrom(['data: {"type":"finish"}\n\ndata: {"partial"']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'finish' }]);
  });

  it('handles malformed JSON by skipping that event (logs to console)', async () => {
    const stream = readableStreamFrom(['data: not-json\n\ndata: {"type":"ok"}\n\n']);
    const events = [];
    for await (const e of parseSSE(stream)) events.push(e);
    expect(events).toEqual([{ type: 'ok' }]);
  });
});
