// tests/isolated/agents/conversation_history/wire_format.test.mjs
import { describe, it, expect } from 'vitest';
import { parseRequest } from '../../../../backend/src/4_api/v1/agents/wireFormats/native.mjs';

const makeReq = (body) => ({ body });

describe('native wire format — parseRequest messages', () => {
  it('passes through a valid messages array', () => {
    const r = parseRequest(makeReq({
      input: 'last',
      context: { userId: 'kckern' },
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'last' },
      ],
    }));
    expect(r.messages).toHaveLength(3);
    expect(r.messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(r.input).toBe('last');
  });

  it('synthesizes [user] from input when messages missing', () => {
    const r = parseRequest(makeReq({ input: 'hello', context: { userId: 'kc' } }));
    expect(r.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('synthesizes [user] from input when messages is empty array', () => {
    const r = parseRequest(makeReq({ input: 'hi', messages: [] }));
    expect(r.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('returns empty array when both input and messages are missing', () => {
    const r = parseRequest(makeReq({}));
    expect(r.messages).toEqual([]);
    expect(r.input).toBe(null);
  });

  it('drops messages with invalid roles', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'frog', content: 'b' },        // invalid
        { role: 'assistant', content: 'c' },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'c' },
    ]);
  });

  it('drops messages with non-string content', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: { complex: 'shape' } },   // dropped
        { role: 'user', content: null },                    // dropped
        { role: 'assistant', content: 'b' },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });

  it('caps to last 20 messages', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const r = parseRequest(makeReq({ messages: many }));
    expect(r.messages).toHaveLength(20);
    expect(r.messages[0].content).toBe('m10');
    expect(r.messages[19].content).toBe('m29');
  });

  it('extracts text from content arrays (assistant-ui shape)', () => {
    const r = parseRequest(makeReq({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: '!' }] },
      ],
    }));
    expect(r.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello!' },
    ]);
  });
});
