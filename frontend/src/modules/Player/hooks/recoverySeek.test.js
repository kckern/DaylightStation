import { describe, it, expect } from 'vitest';
import { computeRecoverySeekMs } from './recoverySeek.js';

const CFG = { nudgeSeconds: 6, maxSamePositionRetries: 2 };

describe('computeRecoverySeekMs', () => {
  it('returns the base seek unchanged on the first failure at a position', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: null, sameCount: 0 }, config: CFG });
    expect(r.seekMs).toBe(258000);
    expect(r.tracker).toEqual({ lastSeekMs: 258000, sameCount: 1 });
  });

  it('does NOT nudge until the same position has failed maxSamePositionRetries times', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: 258000, sameCount: 1 }, config: CFG });
    expect(r.seekMs).toBe(258000);
    expect(r.tracker.sameCount).toBe(2);
  });

  it('nudges forward once the same position exceeds the retry budget', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 258000, tracker: { lastSeekMs: 258000, sameCount: 2 }, config: CFG });
    expect(r.seekMs).toBe(264000); // +6s past the poisoned segment
    expect(r.tracker.lastSeekMs).toBe(264000);
  });

  it('resets the counter when the base position changes (genuine progress)', () => {
    const r = computeRecoverySeekMs({ baseSeekMs: 300000, tracker: { lastSeekMs: 258000, sameCount: 5 }, config: CFG });
    expect(r.seekMs).toBe(300000);
    expect(r.tracker).toEqual({ lastSeekMs: 300000, sameCount: 1 });
  });
});
