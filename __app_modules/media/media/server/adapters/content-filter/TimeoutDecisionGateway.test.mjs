import { describe, it, expect } from 'vitest';
import { TimeoutDecisionGateway } from './TimeoutDecisionGateway.mjs';

describe('TimeoutDecisionGateway', () => {
  it('rejects JEV_TIMEOUT when the inner gateway never resolves', async () => {
    const g = new TimeoutDecisionGateway({ evaluate: () => new Promise(() => {}) }, { timeoutMs: 20 });
    await expect(g.evaluate({}, {})).rejects.toMatchObject({ code: 'JEV_TIMEOUT', timeoutMs: 20 });
  });
  it('passes an answer through and hands the inner gateway the timeout', async () => {
    let seen;
    const g = new TimeoutDecisionGateway({ evaluate: async (s, q, o) => { seen = o; return { model: 'm', answers: { a: 1 } }; } }, { timeoutMs: 500 });
    await expect(g.evaluate({}, {})).resolves.toEqual({ model: 'm', answers: { a: 1 } });
    expect(seen.timeout).toBe(500);
  });
  it('passes inner errors through', async () => {
    const g = new TimeoutDecisionGateway({ evaluate: async () => { throw new Error('boom'); } }, { timeoutMs: 500 });
    await expect(g.evaluate({}, {})).rejects.toThrow('boom');
  });
  it('a synchronous throw from the inner gateway rejects and leaves no timer armed', async () => {
    const unhandled = [];
    const onUnhandled = (e) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const g = new TimeoutDecisionGateway({ evaluate: () => { throw new Error('sync boom'); } }, { timeoutMs: 30 });
      let p;
      expect(() => { p = g.evaluate({}, {}); }).not.toThrow();
      await expect(p).rejects.toThrow('sync boom');
      await new Promise((r) => setTimeout(r, 80));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
