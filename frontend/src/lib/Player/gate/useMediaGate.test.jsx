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
import { PAUSE_REASON } from './pauseArbiter.js';

// `vi.mock` factories are hoisted above every import, so the spy registry has to be
// hoisted with them.
const hoisted = vi.hoisted(() => ({ gates: [] }));

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
  // ADVISORY (traced, benign, previously undocumented). `ownsPause` is deliberately
  // held across the in-flight window of a SUCCESSFUL resume, so a human pause landing
  // inside that window is filtered as our echo and never reaches the `user` slot. It
  // is harmless: the settle releases ownership WITHOUT re-playing, so the pause stands.
  // Written down so a future reader finds the trace instead of re-deriving it.
  it('filters a human pause landing inside a successful resume, and the pause still stands', async () => {
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
    expect(result.current.decision.reason).toBe(PAUSE_REASON.PLAYING);  // filtered as echo

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
