import { describe, it, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

describe('pauseArbiter — a blocked gate is a real block', () => {
  it('pauses while a gate blocks, even if the user is trying to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }],
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false } // user wants to play
    });
    expect(decision.paused).toBe(true);
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe('governance');
  });

  it('does not pause once the gate releases and the user wants to play', () => {
    const decision = resolvePause({
      seeking: { active: false },
      gates: [{ blocked: false, id: 'governance', seekCeiling: null }],
      resilience: { stalled: false, waitingToPlay: false },
      user: { paused: false }
    });
    expect(decision.reason).not.toBe(PAUSE_REASON.GATE);
    expect(decision.blocked).toBe(false);
    expect(decision.gate).toBe(null);
  });
});

describe('gates array (GateVerdict composition)', () => {
  it('any blocked gate pauses, first blocked in array order wins the reason', () => {
    const r = resolvePause({ gates: [
      { blocked: false, id: 'household', seekCeiling: null },
      { blocked: true, id: 'checkpoint', seekCeiling: 312 },
      { blocked: true, id: 'governance', seekCeiling: null },
    ] });
    expect(r).toEqual({ paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 312 });
  });
  it('seeking suppresses gate pause (anti-thrash rule unchanged)', () => {
    const r = resolvePause({ seeking: { active: true }, gates: [{ blocked: true, id: 'checkpoint' }] });
    expect(r.paused).toBe(false);
    expect(r.reason).toBe(PAUSE_REASON.SEEKING);
  });

  // The contract the enforcement layer depends on. `paused` is suppressed mid-seek,
  // but `blocked`/`gate`/`seekCeiling` are standing facts and MUST survive — a
  // "simplification" of the SEEKING branch to `{paused:false, reason:SEEKING}`
  // passes every other test here while silently killing the seek clamp in production.
  it('blocked, gate and seekCeiling all survive a seek', () => {
    const r = resolvePause({
      seeking: { active: true },
      gates: [{ blocked: true, id: 'checkpoint', seekCeiling: 312 }]
    });
    expect(r).toEqual({
      paused: false, reason: PAUSE_REASON.SEEKING, blocked: true, gate: 'checkpoint', seekCeiling: 312
    });
  });

  it('seekCeiling composes as min of non-null ceilings, even with no gate blocked', () => {
    const r = resolvePause({ gates: [
      { blocked: false, id: 'a', seekCeiling: 500 },
      { blocked: false, id: 'b', seekCeiling: 312 },
      { blocked: false, id: 'c', seekCeiling: null },
    ] });
    expect(r.paused).toBe(false);
    expect(r.seekCeiling).toBe(312);
  });

  // 0 is a plausible ceiling ("no seeking at all"), and it is finite — it must not
  // be dropped by a falsy check.
  it('a seekCeiling of 0 composes rather than being dropped as falsy', () => {
    const r = resolvePause({ gates: [
      { blocked: false, id: 'a', seekCeiling: 0 },
      { blocked: false, id: 'b', seekCeiling: 312 },
    ] });
    expect(r.seekCeiling).toBe(0);
  });

  it('an empty-string id falls back to a usable gate name', () => {
    const r = resolvePause({ gates: [{ blocked: true, id: '' }] });
    expect(r.blocked).toBe(true);
    expect(r.gate).toBe('gate');
  });

  it('a null entry inside gates does not throw', () => {
    const r = resolvePause({ gates: [null, { blocked: true, id: 'checkpoint' }] });
    expect(r.paused).toBe(true);
    expect(r.gate).toBe('checkpoint');
  });

  it('no gates, no ceiling: result shape is stable', () => {
    expect(resolvePause({})).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });
  it('a null gates slot is tolerated like an absent one (callers pass state that can be null)', () => {
    expect(resolvePause({ gates: null })).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });

  // `useMediaGate` forwards `player: { seeking, resilience, user }` straight through,
  // and any of those is null before its source resolves. Destructuring defaults only
  // fire on `undefined`, so each null slot has to be normalized or the first read
  // (`seeking.active`) throws inside a kiosk render.
  it('a null seeking slot is tolerated', () => {
    expect(resolvePause({ seeking: null })).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });

  it('a null resilience slot is tolerated', () => {
    expect(resolvePause({ resilience: null })).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });

  it('a null user slot is tolerated', () => {
    expect(resolvePause({ user: null })).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });

  it('every slot null at once still yields the stable PLAYING shape', () => {
    expect(resolvePause({ seeking: null, gates: null, resilience: null, user: null })).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
  });
});

describe('pauseArbiter — precedence below the gate layer', () => {
  it('buffering pauses when no gate blocks', () => {
    const decision = resolvePause({ resilience: { waiting: true }, user: { paused: false } });
    expect(decision).toEqual({
      paused: true, reason: PAUSE_REASON.BUFFERING, blocked: false, gate: null, seekCeiling: null
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
      paused: true, reason: PAUSE_REASON.USER, blocked: false, gate: null, seekCeiling: null
    });
  });

  it('a blocked gate outranks a user pause (the gate reason is what surfaces)', () => {
    const decision = resolvePause({
      gates: [{ blocked: true, id: 'checkpoint' }],
      user: { paused: true }
    });
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe('checkpoint');
  });
});
