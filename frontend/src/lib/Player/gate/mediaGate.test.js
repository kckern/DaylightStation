import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMediaGate } from './mediaGate.js';
import { PAUSE_REASON } from './pauseArbiter.js';

/**
 * Minimal EventTarget-ish `HTMLMediaElement` stand-in. Deliberately hand-rolled
 * rather than jsdom's real element: we need `play()` to be a spy whose promise we
 * control (the garage kiosk's Firefox rejects it under the autoplay policy), and
 * we need to assert on the exact add/removeEventListener pairs.
 */
const makeEl = ({ paused = false, currentTime = 0, play } = {}) => {
  const listeners = new Map();
  const el = {
    paused,
    currentTime,
    play: vi.fn(play || (() => { el.paused = false; return Promise.resolve(); })),
    pause: vi.fn(() => { el.paused = true; }),
    addEventListener: vi.fn((type, cb) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
    }),
    removeEventListener: vi.fn((type, cb) => { listeners.get(type)?.delete(cb); }),
    dispatchEvent: (type) => {
      [...(listeners.get(type) || [])].forEach((cb) => cb({ type, target: el }));
    },
    listenerCount: (type) => (listeners.get(type)?.size || 0)
  };
  return el;
};

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn()
});

const events = (logger, method = 'info') => logger[method].mock.calls.map((c) => c[0]);

/** Full `resolvePause`-shaped decisions, so the tests consume the real contract. */
const BLOCKING = { paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: null };
const RELEASED = { paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null };
const MID_SEEK_BLOCKED = { paused: false, reason: PAUSE_REASON.SEEKING, blocked: true, gate: 'checkpoint', seekCeiling: 100 };

let logger;
beforeEach(() => { logger = makeLogger(); });

describe('mediaGate — enforcing a pause', () => {
  it('pauses a playing element when a gate blocks', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.paused).toBe(true);
  });

  it('is idempotent: repeated identical decisions neither re-pause nor re-log', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.apply(BLOCKING);
    gate.apply(BLOCKING);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(events(logger).filter((e) => e === 'gate.blocked')).toHaveLength(1);
  });

  it('does not throw when the element has not mounted yet', () => {
    const gate = createMediaGate({ getMediaEl: () => null, logger });
    expect(() => gate.apply(BLOCKING)).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('mediaGate — releasing', () => {
  it('resumes an element the gate itself paused', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('NEVER auto-plays an element the gate did not pause (user pause stays paused)', () => {
    const el = makeEl({ paused: true }); // the user hit pause
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(RELEASED);
    gate.apply(RELEASED);
    expect(el.play).not.toHaveBeenCalled();
    expect(el.paused).toBe(true);
  });

  // The regression the plan amendment exists to prevent: resume is conditioned on
  // `!blocked`, never on `paused === false` alone. Mid-seek the arbiter suppresses
  // the pause ACTION but the checkpoint still blocks; playing here would re-pause
  // on seek end — the thrash the seeking rule exists to stop.
  it('MID-SEEK, STILL BLOCKED: does not play even though decision.paused is false', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    expect(el.pause).toHaveBeenCalledTimes(1);
    gate.apply(MID_SEEK_BLOCKED);
    expect(el.play).not.toHaveBeenCalled();
    expect(el.paused).toBe(true);
  });

  it('does not resume for a non-gate pause that is still standing (buffering)', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply({ paused: true, reason: PAUSE_REASON.BUFFERING, blocked: false, gate: null, seekCeiling: null });
    expect(el.pause).toHaveBeenCalledTimes(1);
    gate.apply({ paused: true, reason: PAUSE_REASON.BUFFERING, blocked: false, gate: null, seekCeiling: null });
    expect(el.play).not.toHaveBeenCalled();
  });

  it('survives a rejected play() (Firefox autoplay policy) without throwing or logging an error', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    expect(() => gate.apply(RELEASED)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // The gate it was resuming FROM must survive into the log — that is the field
    // that tells you which lesson is now stuck paused on the kiosk.
    expect(logger.sampled).toHaveBeenCalledWith('gate.resume-failed',
      { gate: 'checkpoint', error: expect.stringContaining('NotAllowedError') },
      { maxPerMinute: 10, aggregate: true });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(el.paused).toBe(true);
  });

  // `apply` runs from a render effect, and a rejected resume keeps ownership so every
  // later apply retries. Under a standing autoplay block (garage Firefox) that is an
  // unbounded stream unless the log is rate-limited — same hazard as the clamp log.
  it('rate-limits the resume-failure log rather than emitting one per apply', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    for (let i = 0; i < 50; i += 1) {
      gate.apply(RELEASED);
      await Promise.resolve(); await Promise.resolve();
    }
    expect(el.play.mock.calls.length).toBeGreaterThan(1);   // it really did keep retrying
    expect(logger.warn).not.toHaveBeenCalled();
    logger.sampled.mock.calls.forEach(([event, , opts]) => {
      expect(event).toBe('gate.resume-failed');
      expect(opts).toEqual({ maxPerMinute: 10, aggregate: true });
    });
  });

  // A rejected resume must not become a permanently stuck lesson: the gate keeps
  // ownership of the pause so the next apply can try again once a gesture has landed.
  it('retries on a later apply after a rejected resume, but never stacks concurrent play() calls', async () => {
    let reject = true;
    const el = makeEl({ paused: false, play: () => (reject ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);

    gate.apply(RELEASED);
    gate.apply(RELEASED);          // still in flight — must not fire a second play()
    expect(el.play).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve();

    reject = false;
    gate.apply(RELEASED);          // in-flight cleared, gate still owns the pause: retry
    expect(el.play).toHaveBeenCalledTimes(2);
    await Promise.resolve(); await Promise.resolve();

    gate.apply(RELEASED);          // resumed for real — nothing left to resume
    expect(el.play).toHaveBeenCalledTimes(2);
  });
});

describe('mediaGate — seek clamp', () => {
  const CEILING = { paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 100 };

  it('snaps a seek past the ceiling back to the ceiling and logs it sampled', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(CEILING);
    el.currentTime = 300;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(100);
    expect(logger.sampled).toHaveBeenCalledWith(
      'gate.seek-clamped',
      { gate: 'checkpoint', from: 300, ceiling: 100 },
      expect.objectContaining({ maxPerMinute: 10 })
    );
  });

  it('leaves a seek below the ceiling untouched', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(CEILING);
    el.currentTime = 42;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(42);
    expect(logger.sampled).not.toHaveBeenCalled();
  });

  it('tolerates a hair past the ceiling rather than fighting float drift', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(CEILING);
    el.currentTime = 100.1;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(100.1);
  });

  it('a ceiling of 0 clamps rather than reading as absent', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply({ ...CEILING, seekCeiling: 0 });
    el.currentTime = 30;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(0);
  });

  it('does not clamp when the ceiling is null', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(RELEASED);
    el.currentTime = 999;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(999);
    expect(logger.sampled).not.toHaveBeenCalled();
  });

  it('clamps while a ceiling stands even with no gate blocking (a ceiling is a standing rule)', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply({ paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: 50 });
    el.currentTime = 80;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(50);
  });

  it('a later decision that drops the ceiling stops clamping without re-attaching', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(CEILING);
    gate.apply(RELEASED);
    expect(el.addEventListener).toHaveBeenCalledTimes(1);
    el.currentTime = 999;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(999);
  });
});

describe('mediaGate — lifecycle', () => {
  it('detach() removes the listener and subsequent seeks are unclamped', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply({ paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 100 });
    gate.detach();
    expect(el.listenerCount('seeking')).toBe(0);
    el.currentTime = 300;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(300);
  });

  it('detach() is idempotent', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.detach();
    expect(() => gate.detach()).not.toThrow();
    expect(el.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('apply() after detach() is inert', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.detach();
    gate.apply(BLOCKING);
    expect(el.pause).not.toHaveBeenCalled();
    expect(el.addEventListener).not.toHaveBeenCalled();
  });

  it('moves its listener when the element is swapped, leaking nothing on the old one', () => {
    const first = makeEl({ paused: false });
    const second = makeEl({ paused: false });
    let current = first;
    const gate = createMediaGate({ getMediaEl: () => current, logger });
    const CEIL = { paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 100 };
    gate.apply(CEIL);
    current = second;
    gate.apply(CEIL);
    expect(first.listenerCount('seeking')).toBe(0);
    expect(second.listenerCount('seeking')).toBe(1);
    gate.detach();
    expect(second.listenerCount('seeking')).toBe(0);
  });

  // A React remount leaves the ref null for a tick. That is "not resolved yet", not a
  // swap: dropping pause ownership there strands a gated lesson paused with nobody
  // left to resume it when the SAME element comes back.
  it('holds pause ownership across a tick where the element ref is momentarily null', () => {
    const el = makeEl({ paused: false });
    let current = el;
    const gate = createMediaGate({ getMediaEl: () => current, logger });
    gate.apply(BLOCKING);
    expect(el.pause).toHaveBeenCalledTimes(1);

    current = null;             // ref not resolved this render
    gate.apply(BLOCKING);
    expect(el.listenerCount('seeking')).toBe(0);   // still unbinds while unresolved

    current = el;               // same element back
    gate.apply(RELEASED);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.listenerCount('seeking')).toBe(1);   // and rebinds
  });

  // What the swap-clear in `bindTo` actually protects now that `resume` checks element
  // identity: an in-flight `play()` on the OUTGOING element must not leave the
  // in-flight latch stuck, or the incoming element can never be resumed again.
  it('does not strand the resume latch when the element swaps mid-play()', () => {
    const first = makeEl({ paused: false, play: () => new Promise(() => {}) }); // never settles
    const second = makeEl({ paused: false });
    let current = first;
    const gate = createMediaGate({ getMediaEl: () => current, logger });

    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    expect(first.play).toHaveBeenCalledTimes(1);   // in flight, unresolved

    current = second;
    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    expect(second.play).toHaveBeenCalledTimes(1);
  });

  it('does not resume a freshly swapped-in element the gate never paused', () => {
    const first = makeEl({ paused: false });
    const second = makeEl({ paused: true });
    let current = first;
    const gate = createMediaGate({ getMediaEl: () => current, logger });
    gate.apply(BLOCKING);       // pauses `first`
    current = second;
    gate.apply(RELEASED);
    expect(second.play).not.toHaveBeenCalled();
  });
});

describe('mediaGate — transition logging', () => {
  it('logs gate.blocked then gate.released across a block/release cycle', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(RELEASED);
    expect(events(logger)).toEqual([]);
    gate.apply(BLOCKING);
    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    gate.apply(RELEASED);
    expect(events(logger)).toEqual(['gate.blocked', 'gate.released']);
    expect(logger.info).toHaveBeenCalledWith('gate.blocked', expect.objectContaining({ gate: 'checkpoint', reason: PAUSE_REASON.GATE }));
    expect(logger.info).toHaveBeenCalledWith('gate.released', expect.objectContaining({ gate: 'checkpoint' }));
  });

  it('logs a fresh gate.blocked when a DIFFERENT gate takes over without a release', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.apply({ ...BLOCKING, gate: 'governance' });
    expect(events(logger)).toEqual(['gate.blocked', 'gate.blocked']);
  });

  // Defensive: the arbiter always names a gate ('gate' is its fallback), but a
  // future governor wired straight into `apply` might not. Keying the transition on
  // the id alone would log nothing at all for that case — null is also "released".
  it('logs the block/release pair even for a gate that does not name itself', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply({ paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: null, seekCeiling: null });
    gate.apply({ paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: null, seekCeiling: null });
    gate.apply(RELEASED);
    expect(events(logger)).toEqual(['gate.blocked', 'gate.released']);
  });

  it('stays blocked (no release) across a seek that suppresses the pause action', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.apply(MID_SEEK_BLOCKED);
    expect(events(logger)).toEqual(['gate.blocked']);
  });
});
