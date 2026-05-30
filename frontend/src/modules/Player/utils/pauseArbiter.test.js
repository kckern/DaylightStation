import { describe, it, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

describe('pauseArbiter — governance lock is a real lock', () => {
  it('resolves to paused (reason GOVERNANCE) while locked, even if the user is trying to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: true },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false } // user wants to play
    });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });

  it('also locks when expressed as videoLocked', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { videoLocked: true },
      resilience: {},
      user: { paused: false }
    });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });

  it('does not pause for governance once the lock clears and the user wants to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: false },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false }
    });
    expect(decision.reason).not.toBe(PAUSE_REASON.GOVERNANCE);
  });
});
