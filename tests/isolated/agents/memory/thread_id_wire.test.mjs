import { describe, it, expect } from 'vitest';
import { parseRequest } from '../../../../backend/src/4_api/v1/agents/wireFormats/native.mjs';

const makeReq = (body) => ({ body });

describe('wire format — threadId', () => {
  it('parses threadId from body root', () => {
    const r = parseRequest(makeReq({ input: 'hi', threadId: 'T-abc' }));
    expect(r.threadId).toBe('T-abc');
  });

  it('falls back to body.context.threadId when not at body root', () => {
    const r = parseRequest(makeReq({ input: 'hi', context: { threadId: 'T-xyz' } }));
    expect(r.threadId).toBe('T-xyz');
  });

  it('prefers body.threadId over body.context.threadId when both present', () => {
    const r = parseRequest(makeReq({
      input: 'hi',
      threadId: 'T-root',
      context: { threadId: 'T-nested' },
    }));
    expect(r.threadId).toBe('T-root');
  });

  it('returns null when threadId is missing', () => {
    const r = parseRequest(makeReq({ input: 'hi' }));
    expect(r.threadId).toBe(null);
  });

  it('rejects non-string threadId', () => {
    const r = parseRequest(makeReq({ input: 'hi', threadId: 123 }));
    expect(r.threadId).toBe(null);
  });

  it('rejects empty-string threadId', () => {
    const r = parseRequest(makeReq({ input: 'hi', threadId: '' }));
    expect(r.threadId).toBe(null);
  });

  it('still returns messages and input alongside threadId', () => {
    const r = parseRequest(makeReq({
      input: 'last',
      threadId: 'T-1',
      messages: [{ role: 'user', content: 'first' }, { role: 'user', content: 'last' }],
    }));
    expect(r.input).toBe('last');
    expect(r.messages).toHaveLength(2);
    expect(r.threadId).toBe('T-1');
  });
});
