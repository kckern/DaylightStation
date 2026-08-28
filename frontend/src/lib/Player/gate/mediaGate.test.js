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

  // MUTATION-PINNED (`if (!el.paused)` before claiming ownership). The existing
  // "never auto-plays" test only covers apply(RELEASED) on an already-paused element;
  // it never runs the sequence that actually matters. Here the human pauses FIRST and
  // a gate blocks AFTERWARDS: without the guard the gate ADOPTS the human's pause and
  // then plays the element on release, overriding a person holding the remote.
  it('never adopts a pause the human made first, even when a gate blocks afterwards', () => {
    const el = makeEl({ paused: true });     // the user hit pause before any gate spoke
    const gate = createMediaGate({ getMediaEl: () => el, logger });

    gate.apply(BLOCKING);
    expect(el.pause).not.toHaveBeenCalled();      // nothing to enforce; it is already down
    expect(gate.getState().ownsPause).toBe(false);

    gate.apply(RELEASED);
    expect(el.play).not.toHaveBeenCalled();       // and so the release is not ours to act on
    expect(el.paused).toBe(true);
  });

  // MUTATION-PINNED (`if (!target.paused) { releaseOwnership(); return; }`). This is
  // the ONLY escape from the retry loop: once a human presses play by hand, the gate
  // must hand the transport back rather than keep acting on a pause it no longer owns.
  it('hands the transport back when the human presses play during a gate-owned pause', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });

    gate.apply(BLOCKING);
    expect(gate.getState().ownsPause).toBe(true);

    el.paused = false;                            // the human pressed play on the remote
    gate.apply(RELEASED);
    expect(el.play).not.toHaveBeenCalled();       // nothing to resume — already playing
    expect(gate.getState().ownsPause).toBe(false);

    el.paused = true;                             // and now the human pauses again
    gate.apply(RELEASED);
    expect(el.play).not.toHaveBeenCalled();       // ownership really was released
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

  it('survives a rejected play() (Firefox autoplay policy) without throwing, and warns once', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    expect(() => gate.apply(RELEASED)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // At WARN, not sampled: `emitSampled` hardcodes level `info`, so a purely sampled
    // event never reaches `level:warn`/`level:error` triage and a lesson stuck behind
    // the autoplay block would be invisible. The gate it was resuming FROM has to
    // survive into the payload — that is what names the stuck lesson.
    expect(logger.warn).toHaveBeenCalledWith('gate.resume-failed',
      { gate: 'checkpoint', error: expect.stringContaining('NotAllowedError') });
    expect(el.paused).toBe(true);
  });

  // `apply` runs from a render effect, and a rejected resume keeps ownership so every
  // later apply retries. Under a standing autoplay block (garage Firefox) that is an
  // unbounded stream at full severity unless the repeats are handed to the budget.
  // NOTE this asserts the ROUTING (one warn head, the rest onto the sampled channel
  // with a budget), not that limiting happened — `logger.sampled` is a stub here and
  // the real limiter lives in Logger.js. The single-warn assertion is what bites.
  it('routes only the first resume failure to warn and every repeat to the sampled budget', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    for (let i = 0; i < 50; i += 1) {
      gate.apply(RELEASED);
      await Promise.resolve(); await Promise.resolve();
    }
    expect(el.play.mock.calls.length).toBeGreaterThan(1);   // it really did keep retrying
    expect(logger.warn).toHaveBeenCalledTimes(1);           // …but said so loudly only once
    expect(logger.sampled.mock.calls.length).toBeGreaterThan(1);
    logger.sampled.mock.calls.forEach(([event, , opts]) => {
      expect(event).toBe('gate.resume-failed');
      expect(opts).toEqual({ maxPerMinute: 10, aggregate: true });
    });
  });

  // FIX 4: a `play()` that never settles used to pin the in-flight latch forever —
  // one play() call, media paused, and not a single log line on an unattended kiosk.
  it('forces the retry latch open when play() never settles, and says so', () => {
    vi.useFakeTimers();
    try {
      const el = makeEl({ paused: false, play: () => new Promise(() => {}) });
      const gate = createMediaGate({ getMediaEl: () => el, logger });
      gate.apply(BLOCKING);

      gate.apply(RELEASED);
      for (let i = 0; i < 20; i += 1) gate.apply(RELEASED);
      expect(el.play).toHaveBeenCalledTimes(1);   // latched, correctly, while it is young
      expect(logger.warn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(6000);
      gate.apply(RELEASED);
      expect(el.play).toHaveBeenCalledTimes(2);   // latch forced open, retried
      expect(logger.warn).toHaveBeenCalledWith('gate.resume-stalled',
        expect.objectContaining({ gate: 'checkpoint' }));
    } finally {
      vi.useRealTimers();
    }
  });

  // The generation guard: the abandoned attempt must not clobber the live one.
  it('ignores a stale play() settling after the latch was forced open', async () => {
    vi.useFakeTimers();
    try {
      let settleFirst;
      let call = 0;
      const el = makeEl({ paused: false, play: () => {
        call += 1;
        return call === 1 ? new Promise((res) => { settleFirst = res; }) : new Promise(() => {});
      } });
      const gate = createMediaGate({ getMediaEl: () => el, logger });
      gate.apply(BLOCKING);
      gate.apply(RELEASED);
      vi.advanceTimersByTime(6000);
      gate.apply(RELEASED);                       // second attempt now in flight
      expect(el.play).toHaveBeenCalledTimes(2);

      settleFirst();                              // the ORPHANED first attempt resolves
      await Promise.resolve(); await Promise.resolve();
      // If the stale resolve had been honoured it would have released ownership, and
      // this apply would do nothing. Ownership is intact, so the latch still holds.
      expect(gate.getState().ownsPause).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  // MUTATION-PINNED (`gateId ?? lastGateSeen`). A ceiling outlives the block that set
  // it — that is the whole point of it being a standing rule — so `gateId` is null by
  // the time a scrub-past happens during free playback. Without the fallback the clamp
  // logs `{ gate: null }` and you cannot tell which lesson the kid was scrubbing.
  it('still names the gate when clamping after that gate released', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(CEILING);                                    // checkpoint blocks, ceiling 100
    gate.apply({ paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: 100 });
    el.currentTime = 300;
    el.dispatchEvent('seeking');
    expect(el.currentTime).toBe(100);
    expect(logger.sampled).toHaveBeenCalledWith('gate.seek-clamped',
      { gate: 'checkpoint', from: 300, ceiling: 100 },
      expect.objectContaining({ maxPerMinute: 10 }));
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

describe('mediaGate — status surface', () => {
  it('starts in a stable released shape', () => {
    const gate = createMediaGate({ getMediaEl: () => makeEl(), logger });
    expect(gate.getState()).toEqual({
      blocked: false, gate: null, seekCeiling: null,
      ownsPause: false, resumeBlocked: false, detached: false
    });
  });

  // The deadlock this surface exists to break: `el.pause()` fires a DOM 'pause' that a
  // caller would route into the arbiter's `user` slot, which would then return
  // PAUSED_USER forever and strand the lesson after a correct answer. `ownsPause` is
  // how the caller tells its own echo from a human's hand.
  it('reports ownsPause for the pause it issued, and drops it once the resume lands', async () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });

    gate.apply({ paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 100 });
    expect(gate.getState()).toEqual({
      blocked: true, gate: 'checkpoint', seekCeiling: 100,
      ownsPause: true, resumeBlocked: false, detached: false
    });

    gate.apply(RELEASED);
    // Deliberately still ours here: `play()` is in flight and has not resolved. Holding
    // ownership across the in-flight window is what lets a rejection be retried, and it
    // keeps the caller from misreading the DOM events of its own resume.
    expect(gate.getState()).toMatchObject({ blocked: false, gate: null, ownsPause: true });

    await Promise.resolve(); await Promise.resolve();
    expect(gate.getState()).toEqual({
      blocked: false, gate: null, seekCeiling: null,
      ownsPause: false, resumeBlocked: false, detached: false
    });
  });

  it('does not claim ownsPause for a pause the human made', () => {
    const el = makeEl({ paused: true });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    expect(gate.getState().ownsPause).toBe(false);
  });

  it('apply() returns the same snapshot getState() would', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    const returned = gate.apply(BLOCKING);
    expect(returned).toBe(gate.getState());
  });

  // Task 3 renders "autoplay blocked — press play" off this. It only becomes true on a
  // promise rejection, which is why a pull-only surface would not have been enough.
  it('raises resumeBlocked when play() is refused and notifies subscribers', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    const seen = [];
    gate.subscribe((snap) => seen.push(snap));

    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    expect(gate.getState().resumeBlocked).toBe(false);   // not known yet — still in flight

    await Promise.resolve(); await Promise.resolve();
    expect(gate.getState().resumeBlocked).toBe(true);
    expect(seen.at(-1).resumeBlocked).toBe(true);
    expect(seen.at(-1).ownsPause).toBe(true);            // still ours to retry
  });

  it('clears resumeBlocked once the human presses play', async () => {
    const el = makeEl({ paused: false, play: () => Promise.reject(new Error('NotAllowedError')) });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    gate.apply(BLOCKING);
    gate.apply(RELEASED);
    await Promise.resolve(); await Promise.resolve();
    expect(gate.getState().resumeBlocked).toBe(true);

    el.paused = false;                                   // the gesture the warning asked for
    gate.apply(RELEASED);
    expect(gate.getState()).toMatchObject({ resumeBlocked: false, ownsPause: false });
  });

  it('notifies only on change, never on a repeated identical decision', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    const seen = [];
    gate.subscribe((snap) => seen.push(snap));
    gate.apply(BLOCKING);
    gate.apply(BLOCKING);
    gate.apply(BLOCKING);
    expect(seen).toHaveLength(1);
  });

  it('unsubscribes, tolerates a non-function, and survives a throwing subscriber', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    expect(() => gate.subscribe(null)()).not.toThrow();

    const seen = [];
    const off = gate.subscribe(() => { throw new Error('bad subscriber'); });
    gate.subscribe((snap) => seen.push(snap));
    expect(() => gate.apply(BLOCKING)).not.toThrow();
    expect(seen).toHaveLength(1);                        // the throwing peer did not stop it

    off();
    gate.apply(RELEASED);
    expect(seen).toHaveLength(2);
  });

  it('marks itself detached and stops notifying', () => {
    const el = makeEl({ paused: false });
    const gate = createMediaGate({ getMediaEl: () => el, logger });
    const seen = [];
    gate.subscribe((snap) => seen.push(snap));
    gate.apply(BLOCKING);
    gate.detach();
    expect(gate.getState()).toMatchObject({ detached: true, ownsPause: false });
    const after = seen.length;
    gate.apply(BLOCKING);
    expect(seen).toHaveLength(after);
  });
});
