import { describe, it, expect } from 'vitest';
import { InMemoryLegitJudgementCache } from './InMemoryLegitJudgementCache.mjs';

describe('InMemoryLegitJudgementCache', () => {
  it('gets what was set by object or string key', () => {
    const c = new InMemoryLegitJudgementCache();
    c.set({ userId: 'u', sittingId: 's', kind: 'end-of-lesson' }, { probability: 0.8, source: 'model' });
    expect(c.get({ kind: 'end-of-lesson', sittingId: 's', userId: 'u' })).toEqual({ probability: 0.8, source: 'model' });
    c.set('abc', 1);
    expect(c.get('abc')).toBe(1);
    expect(c.get('nope')).toBeNull();
  });
  it('expires after ttl and evicts the oldest past maxEntries', () => {
    let now = 0;
    const c = new InMemoryLegitJudgementCache({ maxEntries: 2, ttlMs: 100, now: () => now });
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeNull();
    expect(c.get('c')).toBe(3);
    now = 200;
    expect(c.get('c')).toBeNull();
  });
});
