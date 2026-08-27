import { describe, it, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

describe('pauseArbiter — governance lock is a real lock', () => {
  it('resolves to paused (reason GATE, gate governance) while locked, even if the user is trying to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: true },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false } // user wants to play
    });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe('governance');
  });

  it('also locks when expressed as videoLocked', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { videoLocked: true },
      resilience: {},
      user: { paused: false }
    });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe('governance');
  });

  it('does not pause for governance once the lock clears and the user wants to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      governance: { locked: false },
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false }
    });
    expect(decision.reason).not.toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe(null);
  });
});

describe('gates array (GateVerdict composition)', () => {
  it('any blocked gate pauses, first blocked in array order wins the reason', () => {
    const r = resolvePause({ gates: [
      { blocked: false, reason: 'household', seekCeiling: null },
      { blocked: true, reason: 'checkpoint', seekCeiling: 312 },
      { blocked: true, reason: 'governance', seekCeiling: null },
    ] });
    expect(r).toEqual({ paused: true, reason: PAUSE_REASON.GATE, gate: 'checkpoint', seekCeiling: 312 });
  });
  it('seeking suppresses gate pause (anti-thrash rule unchanged)', () => {
    const r = resolvePause({ seeking: { active: true }, gates: [{ blocked: true, reason: 'checkpoint' }] });
    expect(r.paused).toBe(false);
    expect(r.reason).toBe(PAUSE_REASON.SEEKING);
  });
  it('seekCeiling composes as min of non-null ceilings, even with no gate blocked', () => {
    const r = resolvePause({ gates: [
      { blocked: false, reason: 'a', seekCeiling: 500 },
      { blocked: false, reason: 'b', seekCeiling: 312 },
      { blocked: false, reason: 'c', seekCeiling: null },
    ] });
    expect(r.paused).toBe(false);
    expect(r.seekCeiling).toBe(312);
  });
  it('legacy governance slot still maps to a gate (alias)', () => {
    const r = resolvePause({ governance: { locked: true } });
    expect(r).toMatchObject({ paused: true, reason: PAUSE_REASON.GATE, gate: 'governance' });
  });
  it('no gates, no ceiling: seekCeiling is null and result shape is stable', () => {
    expect(resolvePause({})).toEqual({ paused: false, reason: PAUSE_REASON.PLAYING, gate: null, seekCeiling: null });
  });
  it('a null gates slot is tolerated like an absent one (callers pass state that can be null)', () => {
    expect(resolvePause({ gates: null })).toEqual({ paused: false, reason: PAUSE_REASON.PLAYING, gate: null, seekCeiling: null });
  });
});

describe('pauseArbiter — precedence below the gate layer', () => {
  it('buffering pauses when no gate blocks', () => {
    const decision = resolvePause({ resilience: { waiting: true }, user: { paused: false } });
    expect(decision).toEqual({
      paused: true, reason: PAUSE_REASON.BUFFERING, gate: null, seekCeiling: null
    });
  });

  it('a stall alone does NOT pause — stall triggers reload, not pause', () => {
    const decision = resolvePause({ resilience: { stalled: true }, user: { paused: false } });
    expect(decision.paused).toBe(false);
    expect(decision.reason).toBe(PAUSE_REASON.PLAYING);
  });

  it('user pause is honoured last, once nothing above it applies', () => {
    const decision = resolvePause({ user: { paused: true } });
    expect(decision).toEqual({
      paused: true, reason: PAUSE_REASON.USER, gate: null, seekCeiling: null
    });
  });

  it('a blocked gate outranks a user pause (the gate reason is what surfaces)', () => {
    const decision = resolvePause({
      gates: [{ blocked: true, reason: 'checkpoint' }],
      user: { paused: true }
    });
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe('checkpoint');
  });
});
