import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useCommonMediaController } from './useCommonMediaController.js';
import * as Logger from '../../../lib/logging/Logger.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';

// The controller logs playback progress to the backend; stub the API client so
// timeupdate-driven logProgress calls can't hit the network (the old version of
// this file leaked one as an unhandled rejection).
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({}))
}));

// Stall-detection timing (mirrors the constants in useCommonMediaController.js).
const SOFT_STALL_MS = 1200;
const HARD_STALL_MS = 8000;
// Soft-check cadence (mirrors STALL_CHECK_INTERVAL_MS). The 2026-07-09 two-phase
// suspicion means a stall is DECLARED one check interval after the first stalled
// verdict (arm → confirming re-sample), so stall-inducing advances below add one
// extra interval.
const STALL_CHECK_INTERVAL_MS = Math.min(500, SOFT_STALL_MS / 3);

// Large cooldown so a prior recorded attempt reliably denies the nudge inside
// a test-driven second episode (real cooldown is 4s with backoff).
const TEST_COOLDOWN_MS = 60000;

const SESSION_KEY = 'session:test-A';

// A stubbed media element getMediaEl() will accept: no shadowRoot, so the hook
// treats the container itself as the media element.
function makeFakeVideo({ currentTime = 100, duration = 1000 } = {}) {
  const listeners = {};
  const el = {
    _ct: currentTime,
    duration,
    paused: false,
    ended: false,
    readyState: 4,
    networkState: 2,
    shadowRoot: null,
    buffered: { length: 1, start: () => 0, end: () => duration },
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => { el.paused = true; }),
    load: vi.fn(),
    getAttribute: () => null,
    setAttribute: () => {},
    removeAttribute: () => {},
    addEventListener: (t, cb) => { (listeners[t] ||= []).push(cb); },
    removeEventListener: (t, cb) => { listeners[t] = (listeners[t] || []).filter(f => f !== cb); },
    getVideoPlaybackQuality: () => ({ totalVideoFrames: 0, droppedVideoFrames: 0 }),
    fire: (t) => { (listeners[t] || []).forEach(cb => cb({ type: t })); }
  };
  Object.defineProperty(el, 'currentTime', { get: () => el._ct, set: (v) => { el._ct = v; } });
  return el;
}

function Harness({ ctrlRef, apiRef, video, recoverySessionKey }) {
  const api = useCommonMediaController({
    meta: { assetId: 'plex:1', title: 'T' },
    isVideo: true,
    recoverySessionKey,
    onController: (c) => { ctrlRef.current = c; }
  });
  apiRef.current = api;
  useEffect(() => { api.containerRef.current = video; }, [api, video]);
  return null;
}

describe('useCommonMediaController stall detection + ledger-gated nudge', () => {
  let events;
  let debugEvents;
  let ledger;
  let requestSpy;
  let successSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    debugEvents = [];
    const child = {
      info: (e, d) => events.push([e, d]),
      warn: (e, d) => events.push([e, d]),
      error: (e, d) => events.push([e, d]),
      debug: (e, d) => debugEvents.push([e, d]),
      sampled: () => {}
    };
    vi.spyOn(Logger, 'getLogger').mockReturnValue({ ...child, child: () => child, sampled: () => {} });

    // Fresh shared ledger per test with an oversized cooldown (see above).
    // vi.useFakeTimers mocks Date.now, so ledger cooldown math follows the
    // advanced timers.
    ledger = createRecoveryLedger({ cooldownMs: TEST_COOLDOWN_MS });
    requestSpy = vi.spyOn(ledger, 'request');
    successSpy = vi.spyOn(ledger, 'recordSuccess');
    _setSharedLedgerForTests(ledger);
  });

  afterEach(() => {
    _setSharedLedgerForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Arms detection with a progress baseline, then freezes the playhead past softMs.
  function renderStalled({ recoverySessionKey = SESSION_KEY } = {}) {
    const ctrlRef = { current: null };
    const apiRef = { current: null };
    const video = makeFakeVideo({ currentTime: 100 });
    render(
      <Harness ctrlRef={ctrlRef} apiRef={apiRef} video={video} recoverySessionKey={recoverySessionKey} />
    );
    expect(ctrlRef.current.getMediaEl()).toBe(video);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
    return { ctrlRef, apiRef, video };
  }

  // Drives the stalled player back to genuine forward progress (resolving the
  // episode), then into a fresh soft stall.
  function resumeThenRestall(video, { advanceTo }) {
    act(() => { video.paused = false; video._ct = advanceTo; video.fire('timeupdate'); });
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
  }

  const strategiesFired = () =>
    events.filter(([e]) => e === 'playback.recovery-strategy').map(([, d]) => d.strategy);

  const nudgeRequests = () =>
    requestSpy.mock.calls.map(([arg]) => arg).filter((arg) => arg.actor === 'controller-nudge');

  it('flags a soft stall after softMs without playhead progress', () => {
    const { ctrlRef, apiRef } = renderStalled();

    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    expect(apiRef.current.isStalled).toBe(true);
    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(1);
    // Soft threshold alone must not trigger any recovery strategy or ledger ask yet.
    expect(strategiesFired()).toEqual([]);
    expect(nudgeRequests()).toEqual([]);
  });

  it('auto-fires exactly one ledger-recorded nudge at the hard threshold; a continuous stall never escalates', () => {
    const { video } = renderStalled();

    // Cross the hard threshold: the single auto actuator (nudge) fires.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);
    // The nudge rewound the playhead by 1ms and tried to resume playback.
    expect(video._ct).toBeCloseTo(100.499, 3);
    expect(video.pause).toHaveBeenCalled();
    expect(video.play).toHaveBeenCalled();

    // The nudge went through the shared recovery ledger, scoped to the real
    // playback session key (not the assetId).
    expect(nudgeRequests()).toEqual([
      expect.objectContaining({
        sessionKey: SESSION_KEY,
        actor: 'controller-nudge',
        reason: 'hard-stall-nudge'
      })
    ]);
    expect(ledger.snapshot(SESSION_KEY)?.count).toBe(1);

    // Stall persists: detection early-returns while isStalled, so the hard
    // timer never re-arms — one nudge per episode, no further escalation
    // (the resilience jolt ladder owns everything beyond the nudge).
    act(() => { vi.advanceTimersByTime(60000); });
    expect(strategiesFired()).toEqual(['nudge']);
    expect(nudgeRequests().length).toBe(1);
  });

  it('falls back to the assetId as ledger scope when no session key is threaded', () => {
    renderStalled({ recoverySessionKey: null });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(nudgeRequests()).toEqual([
      expect.objectContaining({ sessionKey: 'plex:1', actor: 'controller-nudge' })
    ]);
  });

  it('suppresses the nudge (debug log, no actuation) when the ledger denies by cooldown', () => {
    const { video } = renderStalled();

    // Episode 1: nudge fires and is recorded.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);

    // Progress resumes (clears the episode AND the ledger via recordSuccess)…
    // then another actor (e.g. a resilience jolt rung) records an attempt,
    // starting a fresh cooldown window.
    resumeThenRestall(video, { advanceTo: 102 });
    ledger.request({ sessionKey: SESSION_KEY, mountId: 'test-jolt', actor: 'jolt', reason: 'test-prior-recovery' });
    const playCallsBefore = video.play.mock.calls.length;

    // Episode 2 crosses the hard threshold inside the cooldown window:
    // the ledger denies, the nudge must NOT fire.
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });

    expect(strategiesFired()).toEqual(['nudge']); // still just episode 1's
    expect(video.play.mock.calls.length).toBe(playCallsBefore);
    const denied = debugEvents.filter(([e]) => e === 'playback.recovery-denied');
    expect(denied.length).toBe(1);
    expect(denied[0][1]).toMatchObject({ strategy: 'nudge', deniedBy: 'cooldown' });
  });

  it('duration-lost escalates to softReinit through the ledger with bypassCooldown (cannot be starved by a jolt cooldown)', () => {
    const { video } = renderStalled();

    // A prior recovery (another actor) has an active cooldown window.
    ledger.request({ sessionKey: SESSION_KEY, mountId: 'test-jolt', actor: 'jolt', reason: 'test-prior-recovery' });

    act(() => { video.duration = NaN; });
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });

    expect(events.filter(([e]) => e === 'playback.duration-lost').length).toBe(1);
    expect(strategiesFired()).toEqual(['softReinit']);
    const reinitRequests = requestSpy.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => arg.actor === 'controller-softreinit');
    expect(reinitRequests).toEqual([
      expect.objectContaining({
        sessionKey: SESSION_KEY,
        actor: 'controller-softreinit',
        reason: 'duration-lost',
        bypassCooldown: true
      })
    ]);
    // The softReinit attempt still counts toward the session cap (visibility).
    expect(ledger.snapshot(SESSION_KEY)?.count).toBe(2);
  });

  it('resolves only on genuine forward advance and clears the ledger via recordSuccess', () => {
    const { ctrlRef, apiRef, video } = renderStalled();

    // Non-advancing timeupdate (nudge / buffer poke) must NOT resolve.
    act(() => { video._ct = 100.5; video.fire('timeupdate'); });
    expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(0);
    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    expect(successSpy).not.toHaveBeenCalled();

    // Escalate past the hard threshold so recovery state is genuinely
    // non-default before the resume: one nudge fires.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);
    expect(ctrlRef.current.readStallState().strategy).toBe('nudge');

    // Genuine forward advance resolves exactly once, resets the snapshot to
    // monitoring, and clears the shared ledger session. (The nudge's pause()
    // left the fake paused and its play() mock never flips it back, so mark
    // the element playing again — real resumed playback is not paused.)
    act(() => { video.paused = false; video._ct = 102.0; video.fire('timeupdate'); });
    expect(events.filter(([e]) => e === 'playback.recovery-resolved').length).toBe(1);
    expect(successSpy).toHaveBeenCalledWith(SESSION_KEY);
    expect(ledger.snapshot(SESSION_KEY)?.count).toBe(0);
    const snap = ctrlRef.current.readStallState();
    expect(snap.status).toBe('monitoring');
    expect(apiRef.current.isStalled).toBe(false);

    // markProgress re-armed detection AND recordSuccess cleared the cooldown:
    // a second stall episode after the resume is detected fresh and fires a
    // second nudge, proving the per-episode gate restarts.
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + STALL_CHECK_INTERVAL_MS + 300); });
    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge', 'nudge']);
    expect(nudgeRequests().length).toBe(2);
  });

  it('declares a stall only after a confirming re-sample (first stalled verdict arms a suspicion)', () => {
    const ctrlRef = { current: null };
    const apiRef = { current: null };
    const video = makeFakeVideo({ currentTime: 100 });
    render(<Harness ctrlRef={ctrlRef} apiRef={apiRef} video={video} recoverySessionKey={SESSION_KEY} />);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });

    // 2026-07-09 fix: the first stalled verdict only arms a confirmation
    // re-sample (one check interval later); a starved main-thread clock snaps
    // forward by then, a real stall stays frozen. Nothing declared or logged yet.
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + 300); });
    expect(ctrlRef.current.readStallState().status).not.toBe('stalled');
    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(0);
    expect(nudgeRequests()).toEqual([]);

    // The re-sample still sees a frozen clock → the stall is declared.
    act(() => { vi.advanceTimersByTime(STALL_CHECK_INTERVAL_MS); });
    expect(ctrlRef.current.readStallState().status).toBe('stalled');
    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(1);

    // Downstream is untouched: the hard threshold still fires one ledger-gated nudge.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS); });
    expect(strategiesFired()).toEqual(['nudge']);
    expect(nudgeRequests().length).toBe(1);
  });

  it('averts the stall (debug telemetry, no warn) when the playhead jumps before confirmation', () => {
    // Session fs 20260709060200: all 41 false stalls self-healed in <30ms —
    // the clock was starved, not the media. The confirmation window must
    // swallow these and leave a countable debug event behind.
    const ctrlRef = { current: null };
    const apiRef = { current: null };
    const video = makeFakeVideo({ currentTime: 100 });
    render(<Harness ctrlRef={ctrlRef} apiRef={apiRef} video={video} recoverySessionKey={SESSION_KEY} />);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });

    // Freeze past softMs — suspicion armed, not yet declared.
    act(() => { vi.advanceTimersByTime(SOFT_STALL_MS + 100); });
    expect(ctrlRef.current.readStallState().status).not.toBe('stalled');

    // Main thread unblocks: the clock snaps forward before the re-sample.
    act(() => { video._ct = 104.2; video.fire('timeupdate'); });
    act(() => { vi.advanceTimersByTime(STALL_CHECK_INTERVAL_MS * 3); });

    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(0);
    const averted = debugEvents.filter(([e]) => e === 'playback.stall_false_positive_averted');
    expect(averted.length).toBe(1);
    expect(averted[0][1].suspectedGapMs).toBeGreaterThanOrEqual(SOFT_STALL_MS);
    expect(averted[0][1].playheadJumpMs).toBe(3700);
    expect(ctrlRef.current.readStallState().status).not.toBe('stalled');
    expect(nudgeRequests()).toEqual([]);
  });

  it('never suspects a stall while the decoder frame counter advances under a frozen clock', () => {
    const ctrlRef = { current: null };
    const apiRef = { current: null };
    const video = makeFakeVideo({ currentTime: 100 });
    // Decoder keeps producing frames even though the main-thread clock is starved.
    let frames = 0;
    video.getVideoPlaybackQuality = () => ({ totalVideoFrames: (frames += 24), droppedVideoFrames: 0 });
    render(<Harness ctrlRef={ctrlRef} apiRef={apiRef} video={video} recoverySessionKey={SESSION_KEY} />);
    act(() => { video._ct = 100.5; video.fire('timeupdate'); video.fire('playing'); });

    // Clock frozen well past softMs (and the hard threshold) while frames advance.
    act(() => { vi.advanceTimersByTime(HARD_STALL_MS + 4000); });

    expect(ctrlRef.current.readStallState().status).not.toBe('stalled');
    expect(events.filter(([e]) => e === 'playback.stalled').length).toBe(0);
    // Frame evidence prevents even a suspicion, so no averted event either.
    expect(debugEvents.filter(([e]) => e === 'playback.stall_false_positive_averted').length).toBe(0);
    expect(nudgeRequests()).toEqual([]);
  });
});
