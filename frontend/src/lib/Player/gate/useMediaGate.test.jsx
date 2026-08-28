/**
 * useMediaGate / GateVerdictContext.
 *
 * WHY THE REAL `createMediaGate` RUNS HERE (and the module is still mocked)
 * ------------------------------------------------------------------------
 * The plan's sketch said "mock the module". A stubbed gate cannot exercise the one
 * requirement this task exists for: the ECHO FILTER. `el.pause()` fires a DOM
 * `pause` event, and the only thing that can tell that echo from a human's hand on
 * the remote is `mediaGate`'s own `ownsPause` — which a stub would have to fake,
 * i.e. the test would assert against a hand-written model of the very behaviour
 * under test.
 *
 * So the mock DELEGATES to the real implementation and only wraps `apply`/`detach`
 * in spies. Wiring assertions (called once, re-applied on change, detached on
 * unmount, NOT re-applied on identity churn) read the spies; behavioural
 * assertions (echo, clamp, autoplay retry) run through real enforcement against a
 * fake element.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { PAUSE_REASON, resolvePause } from './pauseArbiter.js';

// `vi.mock` factories are hoisted above every import, so the spy registry has to be
// hoisted with them.
const hoisted = vi.hoisted(() => ({ gates: [], moduleLogs: [] }));

vi.mock('./mediaGate.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createMediaGate: vi.fn((opts) => {
      const real = actual.createMediaGate(opts);
      const wrapped = {
        apply: vi.fn((decision) => real.apply(decision)),
        getState: () => real.getState(),
        subscribe: (cb) => real.subscribe(cb),
        detach: vi.fn(() => real.detach())
      };
      hoisted.gates.push(wrapped);
      return wrapped;
    })
  };
});

// `GateVerdictContext` has no logger injection point (its dev check is not part of the
// public API), so the module logger is the only way to observe it.
vi.mock('../../logging/Logger.js', () => {
  const record = (level) => (event, data) => hoisted.moduleLogs.push({ level, event, data });
  const child = () => ({
    debug: record('debug'), info: record('info'),
    warn: record('warn'), error: record('error'), sampled: record('sampled')
  });
  const getLogger = () => ({ child, ...child() });
  return { getLogger, default: getLogger };
});

import { createMediaGate } from './mediaGate.js';
import { useMediaGate } from './useMediaGate.js';
import { GateVerdictProvider, useContributedVerdicts } from './GateVerdictContext.jsx';

/**
 * `HTMLMediaElement` stand-in that fires the spec-mandated transport events.
 *
 * `echo: true` (default) dispatches SYNCHRONOUSLY from inside `pause()`/`play()` —
 * the worst case, and the one that catches an echo filter relying on `ownsPause`
 * alone (the gate assigns ownership AFTER `el.pause()` returns). `echo: false`
 * models a real browser, which queues the event as a task; those tests dispatch by
 * hand after `apply` has returned.
 */
const makeEl = ({ paused = false, currentTime = 0, play, echo = true } = {}) => {
  const listeners = new Map();
  const el = {
    paused,
    currentTime,
    play: vi.fn(play || (() => {
      const was = el.paused;
      el.paused = false;
      if (echo && was) el.dispatchEvent('play');
      return Promise.resolve();
    })),
    pause: vi.fn(() => {
      const was = el.paused;
      el.paused = true;
      if (echo && !was) el.dispatchEvent('pause');
    }),
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

/** Event names emitted at one level, in call order. */
const events = (log, method = 'info') => log[method].mock.calls.map((c) => c[0]);

const BLOCKED = (over = {}) => ({ blocked: true, id: 'checkpoint', seekCeiling: null, ...over });
const OPEN = (over = {}) => ({ blocked: false, id: 'checkpoint', seekCeiling: null, ...over });

let logger;
beforeEach(() => {
  hoisted.gates.length = 0;
  hoisted.moduleLogs.length = 0;
  createMediaGate.mockClear();
  logger = makeLogger();
});
afterEach(() => { vi.useRealTimers(); });

/** The single gate the hook built for the current render tree. */
const gate = (i = 0) => hoisted.gates[i];

describe('useMediaGate — wiring', () => {
  it('resolves the merged verdicts and applies the decision through one gate', () => {
    const el = makeEl({ paused: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el,
      verdicts: [BLOCKED({ seekCeiling: 312 })],
      logger
    }));

    expect(createMediaGate).toHaveBeenCalledTimes(1);
    expect(result.current.decision).toEqual({
      paused: true, reason: PAUSE_REASON.GATE, blocked: true, gate: 'checkpoint', seekCeiling: 312
    });
    expect(gate().apply).toHaveBeenCalledTimes(1);
    expect(gate().apply).toHaveBeenCalledWith(result.current.decision);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current.status).toMatchObject({ blocked: true, gate: 'checkpoint', ownsPause: true });
  });

  it('re-applies when the verdicts change, and releases the transport', () => {
    const el = makeEl({ paused: false });
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    expect(el.pause).toHaveBeenCalledTimes(1);

    rerender({ verdicts: [OPEN()] });
    expect(gate().apply).toHaveBeenCalledTimes(2);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);
  });

  // The 495-transcode-session shape: an inline array literal is a NEW array every
  // render. Re-applying on identity alone would retry `play()` once per render.
  it('does NOT re-apply when an equal-but-new verdicts literal arrives (identity churn)', () => {
    const el = makeEl({ paused: false });
    const { rerender } = renderHook(
      ({ n }) => useMediaGate({
        getMediaEl: () => el,
        // A fresh array AND fresh objects every render, exactly as a careless caller writes it.
        verdicts: [{ blocked: false, id: 'checkpoint', seekCeiling: null }],
        player: { seeking: { active: false }, resilience: {}, user: {} },
        logger,
        n
      }),
      { initialProps: { n: 0 } }
    );
    for (let n = 1; n <= 5; n += 1) rerender({ n });
    expect(gate().apply).toHaveBeenCalledTimes(1);
    expect(el.play).not.toHaveBeenCalled();
  });

  it('detaches the gate and unbinds its DOM listeners on unmount', () => {
    const el = makeEl({ paused: false });
    const { unmount } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [BLOCKED()], logger
    }));
    expect(el.listenerCount('pause')).toBe(1);

    unmount();
    expect(gate().detach).toHaveBeenCalledTimes(1);
    expect(gate().getState().detached).toBe(true);
    expect(el.listenerCount('pause')).toBe(0);
    expect(el.listenerCount('play')).toBe(0);
    expect(el.listenerCount('seeking')).toBe(0);
  });

  // MUTATION-PINNED (gate built INSIDE the effect, not in useMemo/useRef).
  // `detach()` is terminal. StrictMode mounts, tears down, and re-mounts effects —
  // a gate built in a ref would be detached by the first cleanup and permanently
  // dead for the real mount, so nothing would ever be enforced again.
  it('survives a StrictMode double-mount (a detached gate is never reused)', () => {
    const el = makeEl({ paused: false });
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { wrapper: StrictMode, initialProps: { verdicts: [OPEN()] } }
    );
    expect(el.pause).not.toHaveBeenCalled();
    expect(el.listenerCount('pause')).toBe(1);   // added twice, removed once

    // A gate built in useRef/useMemo would have been detached by StrictMode's
    // throwaway cleanup, and `detach()` is terminal: this pause would never happen.
    rerender({ verdicts: [BLOCKED()] });
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current.status).toMatchObject({ detached: false, ownsPause: true, blocked: true });
  });

  it('tolerates null player slots and an absent element', () => {
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => null,
      verdicts: null,
      player: { seeking: null, resilience: null, user: null },
      logger
    }));
    expect(result.current.decision).toEqual({
      paused: false, reason: PAUSE_REASON.PLAYING, blocked: false, gate: null, seekCeiling: null
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  // MINOR from review, and it turned out to be observable. `mediaGate.js` is explicit
  // that a null hand-back is NOT a swap (a remount leaves the ref null for a render).
  // Clearing observed user intent there desyncs the wrapper from the module: the
  // decision flips USER -> PLAYING under a person who never touched anything.
  it('a null blip in the element ref does not discard observed user intent', () => {
    vi.useFakeTimers();
    const el = makeEl({ paused: false, echo: false });
    let current = el;
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => current, verdicts: [OPEN()], logger
    }));

    act(() => { el.paused = true; el.dispatchEvent('pause'); });
    expect(result.current.decision.reason).toBe(PAUSE_REASON.USER);

    current = null;                                   // one unresolved render
    act(() => { vi.advanceTimersByTime(300); });
    current = el;                                     // the same element comes back
    act(() => { vi.advanceTimersByTime(300); });

    expect(result.current.decision.reason).toBe(PAUSE_REASON.USER);
    expect(el.play).not.toHaveBeenCalled();
  });

  it('stamps the correlation id on every gate event', () => {
    const el = makeEl({ paused: false, echo: false });
    renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [BLOCKED()], contentId: 'astronomy-e03', logger
    }));
    const mounted = logger.info.mock.calls.find((c) => c[0] === 'gate.hook.mounted');
    expect(mounted?.[1]).toMatchObject({ contentId: 'astronomy-e03' });
  });

  it('binds and enforces against an element that mounts late', () => {
    vi.useFakeTimers();
    let el = null;
    renderHook(() => useMediaGate({ getMediaEl: () => el, verdicts: [BLOCKED()], logger }));

    el = makeEl({ paused: false });
    act(() => { vi.advanceTimersByTime(300); });

    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(el.listenerCount('pause')).toBe(1);
  });
});

describe('useMediaGate — the gate must not mistake its own echo for a human', () => {
  // (b) from the task: the deadlock. A gate-issued pause routed into the `user`
  // slot returns PAUSED_USER forever and the lesson sticks AFTER a correct answer.
  it('a gate-issued pause never becomes PAUSED_USER (synchronous echo)', () => {
    const el = makeEl({ paused: false });          // fires 'pause' from inside el.pause()
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current.decision.reason).toBe(PAUSE_REASON.GATE);

    rerender({ verdicts: [OPEN()] });              // the kid answered correctly
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  it('a gate-issued pause never becomes PAUSED_USER (queued echo, real-browser shape)', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    // The browser fires the event as a queued task, AFTER apply returned.
    act(() => { el.dispatchEvent('pause'); });
    expect(result.current.decision.reason).toBe(PAUSE_REASON.GATE);

    rerender({ verdicts: [OPEN()] });
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  // Pins the OTHER half of the two-part test. `lastAppliedPaused` alone is not enough:
  // it says our last ACTION was a pause, not that the pause on THIS element is ours.
  // The seam is real — a decision can be `paused` with no element bound yet (buffering
  // before the ref resolves), and the element binds one tick before the next apply. A
  // human pausing in that window is filed correctly only because `ownsPause` is false.
  it('a human pause on an element the gate does not own reaches the user slot', () => {
    vi.useFakeTimers();
    const el = makeEl({ paused: false, echo: false });
    let current = null;                       // ref not resolved yet
    const { result, rerender } = renderHook(
      ({ resilience }) => useMediaGate({
        getMediaEl: () => current, verdicts: [OPEN()], player: { resilience }, logger
      }),
      { initialProps: { resilience: { buffering: true } } }
    );
    // Decision is `paused` (BUFFERING) with nothing bound: last action was a pause,
    // but the gate owns nothing.
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.BUFFERING });
    expect(result.current.status.ownsPause).toBe(false);

    // The element binds on this supervisor pass; the human pauses before the apply
    // that the pass schedules can run.
    current = el;
    act(() => { vi.advanceTimersByTime(300); el.paused = true; el.dispatchEvent('pause'); });

    // Buffering clears. Their pause must survive it.
    rerender({ resilience: {} });
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });
    expect(el.play).not.toHaveBeenCalled();
  });

  it('a HUMAN pause DOES reach the user slot', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [OPEN()], logger
    }));
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);

    act(() => { el.paused = true; el.dispatchEvent('pause'); });
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });
    expect(el.play).not.toHaveBeenCalled();
  });

  it('a DOM play releases the user-pause latch instead of stranding the lesson', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [OPEN()], logger
    }));
    act(() => { el.paused = true; el.dispatchEvent('pause'); });
    expect(result.current.decision.reason).toBe(PAUSE_REASON.USER);

    act(() => { el.paused = false; el.dispatchEvent('play'); });
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);
    expect(el.pause).not.toHaveBeenCalled();       // the gate must not shove them back down
  });

  // MUTATION-PINNED against any attempt to filter DOM `play` on `ownsPause`.
  // A kid pressing play to skip an unanswered checkpoint arrives with ownsPause TRUE
  // (the gate paused them) and resumeBlocked FALSE — indistinguishable, on the status
  // surface alone, from the gate's own resume echo. Filtering either shape lets them
  // through, and a skipped checkpoint is far worse than a mislabelled log line.
  it('re-pauses a human who presses play while a gate is still blocking', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [BLOCKED()], logger
    }));
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(result.current.status.ownsPause).toBe(true);

    act(() => { el.paused = false; el.dispatchEvent('play'); });   // the skip attempt

    expect(el.pause).toHaveBeenCalledTimes(2);                     // put straight back
    expect(el.paused).toBe(true);
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.GATE });
  });

  // The probe-confirmed regression from Task 2's review, end to end.
  it('honours a human pause taken back during a gate-owned autoplay retry', async () => {
    const el = makeEl({
      paused: false,
      echo: false,
      play: vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    });
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    expect(el.pause).toHaveBeenCalledTimes(1);

    // Correct answer → release. Firefox on the garage kiosk rejects the resume.
    rerender({ verdicts: [OPEN()] });
    await act(async () => {});
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current.status.resumeBlocked).toBe(true);
    expect(result.current.status.ownsPause).toBe(true);   // held so a retry is possible

    // The human supplies the gesture the autoplay policy wanted.
    act(() => { el.paused = false; el.dispatchEvent('play'); });
    expect(result.current.status.ownsPause).toBe(false);  // transport handed back

    // …and then pauses by hand. The gate must NOT override that.
    act(() => { el.paused = true; el.dispatchEvent('pause'); });
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });
    expect(el.play).toHaveBeenCalledTimes(1);             // no second, overriding play()
    expect(el.paused).toBe(true);
  });
  // THE SECOND ECHO WINDOW — the same failure requirement (a) exists to prevent,
  // arriving one step earlier. While a resume is IN FLIGHT (a Plex stream can take
  // seconds to start) `ownsPause` is still true, so a parent's pause used to be filed
  // as our echo; the browser then aborts the pending `play()`, ownership is held for
  // retry, and the NEXT apply plays right over them. `ownsPause` is the wrong question
  // here — the right one is whether our last transport action was a pause or a play.
  it('attributes a pause taken DURING a pending resume to the human, and never plays over it', async () => {
    let rejectPlay = null;
    const el = makeEl({
      paused: false,
      echo: false,
      play: vi.fn(() => { el.paused = false; return new Promise((_res, rej) => { rejectPlay = rej; }); })
    });
    // Spec-accurate: pause() aborts a pending play() with AbortError.
    const rawPause = el.pause;
    el.pause = vi.fn(() => {
      rawPause();
      if (rejectPlay) { rejectPlay(new Error('AbortError')); rejectPlay = null; }
    });

    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    expect(el.pause).toHaveBeenCalledTimes(1);

    rerender({ verdicts: [OPEN({ seekCeiling: 312 })] });   // the child answered correctly
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.paused).toBe(false);                          // stream starting, promise pending
    expect(result.current.status.ownsPause).toBe(true);     // held, correctly

    // A parent presses pause while the resume is still in flight.
    act(() => { el.pause(); el.dispatchEvent('pause'); });
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });

    await act(async () => {});                              // the AbortError lands
    expect(result.current.status.resumeBlocked).toBe(true);

    // Any later apply at all — here a ceiling update — must not play over them.
    rerender({ verdicts: [OPEN({ seekCeiling: 600 })] });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.paused).toBe(true);
  });

  // The SUCCESSFUL-resume counterpart of the test above. This window was previously
  // mis-attributed too (filed as our echo, decision stuck at PLAYING); it was benign
  // only because a successful settle releases ownership without re-playing. The
  // two-part echo test fixes the attribution, and the outcome is unchanged: their
  // pause stands either way. Both halves are asserted so a regression in either shows.
  it('attributes a human pause inside a successful resume, and the pause still stands', async () => {
    let settle;
    const el = makeEl({
      paused: false,
      echo: false,
      play: vi.fn(() => { el.paused = false; return new Promise((res) => { settle = res; }); })
    });
    const { result, rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    rerender({ verdicts: [OPEN()] });
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(result.current.status.ownsPause).toBe(true);      // held until the promise settles

    // The human pauses while our play() is still unsettled.
    act(() => { el.paused = true; el.dispatchEvent('pause'); });
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });

    await act(async () => { settle(); });
    expect(result.current.status.ownsPause).toBe(false);      // settle releases ownership
    expect(el.play).toHaveBeenCalledTimes(1);                 // and does NOT re-play
    expect(el.paused).toBe(true);                             // so their pause stands
  });

  it('never attributes the gate\'s own resume to the viewer in the logs', () => {
    const el = makeEl({ paused: false, echo: false });
    const { rerender } = renderHook(
      ({ verdicts }) => useMediaGate({ getMediaEl: () => el, verdicts, logger }),
      { initialProps: { verdicts: [BLOCKED()] } }
    );
    rerender({ verdicts: [OPEN()] });
    // A real browser queues `play`, so it lands after apply returned — the shape that
    // used to log a spurious "the user pressed play".
    act(() => { el.dispatchEvent('play'); });
    expect(events(logger, 'info')).not.toContain('gate.user-play-observed');
    expect(events(logger, 'debug')).toContain('gate.play-observed-while-owned');
  });
});

describe('useMediaGate — the clamp must not suppress the pause it is enforcing', () => {
  it('a clamp-issued seek leaves the gate decision untouched', () => {
    const el = makeEl({ paused: false, currentTime: 0, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [BLOCKED({ seekCeiling: 100 })], logger
    }));
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.GATE });

    act(() => { el.currentTime = 500; el.dispatchEvent('seeking'); });

    expect(el.currentTime).toBe(100);                       // clamped by mediaGate
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.GATE });
    expect(el.play).not.toHaveBeenCalled();
  });

  it('the hook itself subscribes to no seeking events (only mediaGate does)', () => {
    const el = makeEl({ paused: false });
    renderHook(() => useMediaGate({ getMediaEl: () => el, verdicts: [BLOCKED({ seekCeiling: 100 })], logger }));
    expect(el.listenerCount('seeking')).toBe(1);
  });

  it('a caller-supplied seek still suppresses the pause action but not the block', () => {
    const el = makeEl({ paused: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el,
      verdicts: [BLOCKED({ seekCeiling: 100 })],
      player: { seeking: { active: true } },
      logger
    }));
    expect(result.current.decision).toMatchObject({
      paused: false, reason: PAUSE_REASON.SEEKING, blocked: true, gate: 'checkpoint'
    });
    expect(el.pause).not.toHaveBeenCalled();
    expect(el.play).not.toHaveBeenCalled();       // resume is conditioned on !blocked
  });
});

describe('useMediaGate — one apply per materially different decision', () => {
  // `sameDecision` is what stops caller identity churn reaching enforcement, and the
  // header calls it "complete by construction". True of the code, and it was untrue of
  // this suite until now: a mutant dropping any single field survived.
  //
  // Only THREE of the five fields are independently reachable, and that is a property
  // of the arbiter, not a gap here. `paused` is a pure function of `reason`
  // (SEEKING/PLAYING => false, GATE/BUFFERING/USER => true) and `blocked` is strictly
  // coupled to `gate` (`gate` is non-null exactly when `blocked`), so no input can move
  // either one alone. Mutants dropping those two are equivalent, not surviving.
  //
  // `seekCeiling` alone is the one that bites in the field: a child clears an early
  // checkpoint, the ceiling advances, and everything else holds. Miss it and the clamp
  // keeps enforcing the old ceiling — the child stays locked out of footage they earned.
  const DECISION_FIELDS = ['paused', 'reason', 'blocked', 'gate', 'seekCeiling'];

  const FIELD_CASES = [
    {
      field: 'seekCeiling',                     // a cleared checkpoint advances the ceiling
      before: { verdicts: [BLOCKED({ seekCeiling: 312 })] },
      after: { verdicts: [BLOCKED({ seekCeiling: 600 })] }
    },
    {
      field: 'gate',                            // household hands off to checkpoint
      before: { verdicts: [{ blocked: true, id: 'household', seekCeiling: null }] },
      after: { verdicts: [{ blocked: true, id: 'lesson', seekCeiling: null }] }
    },
    {
      field: 'reason',                          // BUFFERING <-> USER, both paused
      before: { verdicts: [OPEN()], player: { resilience: { buffering: true } } },
      after: { verdicts: [OPEN()], player: { user: { paused: true } } }
    }
  ];

  // Turns "the other two mutants are equivalent" from a claim into a checked property.
  // If the arbiter ever decouples these, this fails and the two dropped comparisons
  // stop being redundant — at which point they need cases in FIELD_CASES above.
  it('paused is a function of reason, and blocked of gate — across every return site', () => {
    const inputs = [
      { seeking: { active: true }, gates: [{ blocked: true, id: 'cp', seekCeiling: 9 }] },
      { seeking: { active: true } },
      { gates: [{ blocked: true, id: 'cp' }] },
      { gates: [{ blocked: true, id: '' }] },
      { gates: [{ blocked: false, id: 'cp', seekCeiling: 5 }] },
      { resilience: { buffering: true } },
      { resilience: { waiting: true } },
      { resilience: { requiresPause: true } },
      { user: { paused: true } },
      { user: { pauseIntent: 'user' } },
      {}
    ];
    const pausedForReason = new Map();
    inputs.forEach((input) => {
      const d = resolvePause(input);
      if (pausedForReason.has(d.reason)) {
        expect(pausedForReason.get(d.reason)).toBe(d.paused);
      } else {
        pausedForReason.set(d.reason, d.paused);
      }
      expect(d.blocked).toBe(d.gate !== null);
    });
    // and the inputs really did exercise every reason the arbiter can return
    expect([...pausedForReason.keys()].sort()).toEqual(Object.values(PAUSE_REASON).sort());
  });

  it.each(FIELD_CASES)('re-applies when $field alone changes', ({ field, before, after }) => {
    const el = makeEl({ paused: false, echo: false });
    const { result, rerender } = renderHook(
      (props) => useMediaGate({ getMediaEl: () => el, logger, ...props }),
      { initialProps: before }
    );
    const first = result.current.decision;
    rerender(after);
    const second = result.current.decision;

    // Proves the case really is a single-field transition, so the apply count below
    // is evidence about THIS field and not about some other one moving with it.
    expect(DECISION_FIELDS.filter((k) => first[k] !== second[k])).toEqual([field]);
    expect(gate().apply).toHaveBeenCalledTimes(2);
  });
});

describe('useMediaGate — the caller\'s own player state', () => {
  it('player.user.paused reaches the decision', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [OPEN()], player: { user: { paused: true } }, logger
    }));
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });
    expect(el.pause).toHaveBeenCalledTimes(1);      // the element is synced to the caller's truth
  });

  it('player.user.pauseIntent reaches the decision', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [OPEN()], player: { user: { pauseIntent: 'user' } }, logger
    }));
    expect(result.current.decision).toMatchObject({ paused: true, reason: PAUSE_REASON.USER });
  });

  it('a blocking gate outranks the caller\'s user pause', () => {
    const el = makeEl({ paused: false, echo: false });
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => el, verdicts: [BLOCKED()], player: { user: { paused: true } }, logger
    }));
    expect(result.current.decision).toMatchObject({ reason: PAUSE_REASON.GATE, gate: 'checkpoint' });
  });
});

describe('GateVerdictContext', () => {
  it('returns an empty array with no provider, and never throws', () => {
    const { result } = renderHook(() => useContributedVerdicts());
    expect(result.current).toEqual([]);
  });

  it('a provider ancestor contributes a verdict into the hook decision', () => {
    const el = makeEl({ paused: false });
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: true, id: 'household', seekCeiling: null }]}>
        {children}
      </GateVerdictProvider>
    );
    const { result } = renderHook(() => useMediaGate({ getMediaEl: () => el, logger }), { wrapper });
    expect(result.current.decision).toMatchObject({
      paused: true, reason: PAUSE_REASON.GATE, gate: 'household'
    });
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('nests outer-first, so the household outranks the lesson', () => {
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: true, id: 'household' }]}>
        <GateVerdictProvider verdicts={[{ blocked: true, id: 'lesson' }]}>
          {children}
        </GateVerdictProvider>
      </GateVerdictProvider>
    );
    const { result } = renderHook(() => useContributedVerdicts(), { wrapper });
    expect(result.current.map((v) => v.id)).toEqual(['household', 'lesson']);
  });

  // MUTATION-PINNED. Both verdicts BLOCK, and only the contributed one carries the
  // lower ceiling — so the assertion fails if the hook drops the contributed array
  // (gate/ceiling both move) AND if it merges its own verdicts first (gate becomes
  // 'lesson', which is the checkpoint a kid can clear while the household lock stands).
  it('the hook merges contributed verdicts BEFORE its own, and both compose', () => {
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: true, id: 'household', seekCeiling: 200 }]}>
        {children}
      </GateVerdictProvider>
    );
    const { result } = renderHook(() => useMediaGate({
      getMediaEl: () => null,
      verdicts: [{ blocked: true, id: 'lesson', seekCeiling: 312 }],
      logger
    }), { wrapper });
    expect(result.current.decision).toMatchObject({
      paused: true, reason: PAUSE_REASON.GATE, gate: 'household', seekCeiling: 200
    });
  });

  // The single most important behavior of this module — a household-level lock
  // RELEASING — and every other test here was a static snapshot.
  it('a provider verdict CHANGE reaches the consumer and releases the transport', () => {
    const el = makeEl({ paused: false, echo: false });
    let household = [{ blocked: true, id: 'household', seekCeiling: null }];
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={household}>{children}</GateVerdictProvider>
    );
    const { result, rerender } = renderHook(
      () => useMediaGate({ getMediaEl: () => el, logger }), { wrapper }
    );
    expect(result.current.decision).toMatchObject({ paused: true, gate: 'household' });
    expect(el.pause).toHaveBeenCalledTimes(1);

    household = [{ blocked: false, id: 'household', seekCeiling: null }];   // the lock lifts
    rerender();

    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);
    expect(el.play).toHaveBeenCalledTimes(1);
  });

  // FIX for the stale-payload trap: the memo freezes verdict OBJECTS while their
  // signed fields hold, so an untracked field silently reads stale — and the SAME
  // field passed through useMediaGate's own `verdicts` prop stays live. Asymmetric,
  // silent, and previously only a comment.
  it('warns in dev when a verdict carries a field the signature cannot track', () => {
    // If DEV were false the assertion below would pass vacuously.
    expect(import.meta.env?.DEV).toBe(true);

    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: true, id: 'lesson', seekCeiling: null, questionId: 'q1' }]}>
        {children}
      </GateVerdictProvider>
    );
    renderHook(() => useContributedVerdicts(), { wrapper });

    const warned = hoisted.moduleLogs.filter((l) => l.event === 'gate.verdict-untracked-fields');
    expect(warned).toHaveLength(1);
    expect(warned[0].level).toBe('warn');
    expect(warned[0].data.fields).toEqual(['questionId']);
  });

  it('says nothing when every field is one the signature tracks', () => {
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: true, id: 'lesson', seekCeiling: 312 }]}>
        {children}
      </GateVerdictProvider>
    );
    renderHook(() => useContributedVerdicts(), { wrapper });
    expect(hoisted.moduleLogs.map((l) => l.event)).not.toContain('gate.verdict-untracked-fields');
  });

  it('holds a stable array identity across re-renders with an equal-but-new literal', () => {
    const seen = [];
    const Probe = () => { seen.push(useContributedVerdicts()); return null; };
    const wrapper = ({ children }) => (
      <GateVerdictProvider verdicts={[{ blocked: false, id: 'household', seekCeiling: null }]}>
        {children}
      </GateVerdictProvider>
    );
    const { rerender } = renderHook(() => { Probe(); return null; }, { wrapper });
    rerender();
    rerender();
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(new Set(seen).size).toBe(1);
  });
});
