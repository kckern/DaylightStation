import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { STALL_JOLT_GRACE_MS, STALL_JOLT_STEP_MS } from '../lib/stallJolt.js';
import {
  SLOW_LINK_WINDOW_MS, SLOW_LINK_QUIET_MS, SLOW_LINK_FROZEN_AHEAD_SEC, SLOW_LINK_MAX_HOLD_MS,
  SLOW_LINK_SESSION_BUDGET_MS, WEDGE_CONFIRM_MS,
} from '../lib/bufferProgress.js';

// 2026-10-28 piano lesson: a direct-play mp4 on a Wi-Fi link delivering ~0.3x
// realtime. The playhead starved over and over while the buffer kept growing;
// every jolt re-requested the stream and threw the download away. A starved
// playhead with a growing buffer is a slow link: hold the ladder, show why.

let fakeNow;
let ledger;
const advance = (ms, onTick) => {
  for (let left = ms; left > 0; left -= 500) {
    const step = Math.min(500, left);
    fakeNow += step;
    onTick?.(step);
    act(() => { vi.advanceTimersByTime(step); });
  }
};

// A progressive element frozen at `currentTime` with ranges given by `state`.
// state.ranges is a list of [start, end]; helpers grow the last range.
const slowEl = ({ currentTime = 300, ahead = 0.2, ranges } = {}) => {
  const state = { ranges: ranges || [[0, currentTime + ahead]] };
  const el = makeFakeEl({ currentTime, duration: 1800, paused: false, seeking: false, readyState: 2, networkState: 2, currentSrc: 'https://example.test/file.mp4' });
  Object.defineProperty(el, 'buffered', {
    get: () => ({ length: state.ranges.length, start: (i) => state.ranges[i][0], end: (i) => state.ranges[i][1] }),
  });
  const grow = (rate) => (ms) => { const r = state.ranges[state.ranges.length - 1]; r[1] += rate * (ms / 1000); };
  return { el, state, grow };
};

const renderStuck = (el, extra = {}) => {
  const args = {
    onReload: vi.fn(), onExhausted: vi.fn(),
    meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
    waitKey: 'wk-1', playbackSessionKey: 'session-slow-link', disabled: false,
    getMediaEl: () => el, seconds: 0, externalStalled: false, ...extra,
  };
  const hook = renderHook((props) => useMediaResilience(props), { initialProps: args });
  act(() => { hook.rerender({ ...args, seconds: 300 }); });
  act(() => { hook.rerender({ ...args, seconds: 300, waitKey: 'wk-2', externalStalled: true }); });
  return { args, hook };
};

beforeEach(() => {
  vi.useFakeTimers();
  fakeNow = 1_000_000;
  ledger = createRecoveryLedger({ now: () => fakeNow, cooldownMs: 0 });
  _setSharedLedgerForTests(ledger);
});
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('jolt ladder on a slow link', () => {
  it('holds every rung while the buffer is growing, and says so on screen', () => {
    const { el, grow } = slowEl();
    const { args, hook } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 3, grow(0.15)); // ahead ≈ 4.3 s
    expect(args.onReload).not.toHaveBeenCalled();
    expect(args.onExhausted).not.toHaveBeenCalled();
    expect(ledger.snapshot(args.playbackSessionKey)?.count ?? 0).toBe(0);
    expect(hook.result.current.overlayProps.linkNotice).toMatch(/slow connection/i);
  });

  it('a download that goes quiet past the quiet window is stuck: the ladder resumes', () => {
    const { el, grow } = slowEl();
    const { args, hook } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + 4000, grow(0.15));
    expect(args.onReload).not.toHaveBeenCalled();
    // A Wi-Fi gap shorter than the quiet window is ridden out…
    advance(SLOW_LINK_QUIET_MS - 4000);
    expect(args.onReload).not.toHaveBeenCalled();
    // …a longer one is not.
    advance(6000);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'stall-jolt-refresh-url' }));
    expect(hook.result.current.overlayProps.linkNotice).toBeNull();
  });

  it('the incident geometry: playhead just past its range, the next range filling ahead — still a slow link', () => {
    // Range ends 20 ms behind the playhead; the seek target's bytes land 0.4 s ahead.
    const { el, state, grow } = slowEl({ currentTime: 13, ranges: [[0, 12.98], [13.4, 13.5]] });
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 2, grow(0.15));
    expect(state.ranges[1][1]).toBeGreaterThan(14);
    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('progressive: bytes arriving (progress events) hold even when growth is under the media floor', () => {
    const { el, grow } = slowEl();
    const { args } = renderStuck(el);
    const tick = grow(0.03); // 0.18 s per 6 s window: under the floor
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 3, (ms) => { tick(ms); act(() => { el._fire('progress'); }); });
    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('MSE: progress events alone do not hold — only buffered growth counts', () => {
    const { el } = slowEl();
    el.currentSrc = 'blob:https://example.test/1';
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS, () => { act(() => { el._fire('progress'); }); });
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a viewer seek during a hold starts a new episode — never jolts back to the old position', () => {
    const { el, state, grow } = slowEl();
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + 2000, grow(0.15));
    expect(args.onReload).not.toHaveBeenCalled();
    // The child presses +30: playhead and buffer move to 330.
    el.currentTime = 330;
    state.ranges = [[0, 300.5], [330, 330.1]];
    advance(STALL_JOLT_GRACE_MS + 4000, grow(0.15));
    expect(args.onReload).not.toHaveBeenCalled();
    // If it then truly dies there, the rung goes to the NEW position.
    advance(SLOW_LINK_QUIET_MS + STALL_JOLT_STEP_MS);
    expect(args.onReload).toHaveBeenCalled();
    expect(args.onReload.mock.calls[0][0].seekToIntentMs).toBe(330_000);
  });

  it('a readyState flip at a check does not fire a rung unless it persists with a frozen clock', () => {
    const { el, grow } = slowEl();
    const { args } = renderStuck(el);
    const g = grow(0.15);
    advance(STALL_JOLT_GRACE_MS + 2000, g);
    // Data lands; the element is about to play (clock moves within ~1 s).
    el.readyState = 4;
    advance(1000, g);
    el.currentTime += 0.5;
    el.readyState = 2;
    advance(4000, g);
    expect(args.onReload).not.toHaveBeenCalled();
  });

  it('readyState HAVE_FUTURE_DATA with a clock that stays frozen is a wedge — jolts after the confirm window', () => {
    const { el, grow } = slowEl();
    el.readyState = 3;
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS, grow(0.15));
    expect(args.onReload).not.toHaveBeenCalled();
    advance(WEDGE_CONFIRM_MS + 1500, grow(0.15));
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a frozen playhead with plenty buffered is a wedge, not a slow link', () => {
    const { el, grow } = slowEl({ ahead: SLOW_LINK_FROZEN_AHEAD_SEC + 2 });
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + WEDGE_CONFIRM_MS + 1500, grow(0.15));
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a frozen playhead whose download keeps going (decoder wedge) jolts once past the frozen-ahead mark', () => {
    const { el, grow } = slowEl();
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS, grow(0.6)); // ahead crosses 5 s at ~8 s
    expect(args.onReload).toHaveBeenCalled();
  });

  it('a hold is bounded: past SLOW_LINK_MAX_HOLD_MS one rung fires, then it holds again', () => {
    // Bytes keep arriving (progressive) but under the media floor, so the
    // frozen-ahead mark is never reached: only the per-hold cap ends it.
    const { el, grow } = slowEl();
    const { args } = renderStuck(el);
    const tick = grow(0.02);
    const alive = (ms) => { tick(ms); act(() => { el._fire('progress'); }); };
    advance(STALL_JOLT_GRACE_MS + SLOW_LINK_MAX_HOLD_MS - 5000, alive);
    expect(args.onReload).not.toHaveBeenCalled();
    advance(10_000, alive);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    advance(STALL_JOLT_STEP_MS * 4, alive);
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a session that has held for its whole budget stops holding (a trickling queue still advances)', () => {
    const { el, grow } = slowEl();
    const { args } = renderStuck(el);
    const tick = grow(0.02);
    const alive = (ms) => { tick(ms); act(() => { el._fire('progress'); }); };
    advance(STALL_JOLT_GRACE_MS + SLOW_LINK_SESSION_BUDGET_MS + 60_000, alive);
    // Several holds expired (one rung each), then the budget ran out and the
    // ladder ran on to exhaustion.
    expect(args.onReload.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(args.onExhausted).toHaveBeenCalled();
  });

  it('an unbuffered, silent stall still jolts at the grace boundary (no regression)', () => {
    const { el } = slowEl();
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS);
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });
});

describe('startup deadline on a slow link', () => {
  const startupArgs = (el) => ({
    onReload: vi.fn(), onExhausted: vi.fn(),
    meta: { mediaType: 'video', title: 'Lesson', src: 'https://example.test/stream/2' },
    waitKey: 'wk-start', playbackSessionKey: 'session-startup-slow', disabled: false,
    getMediaEl: () => el, seconds: 0, isPaused: false, isSeeking: false, mediaTypeHint: 'video',
  });

  it('defers while the header is still arriving (readyState 0 + progress), then recovers once bytes stop', () => {
    const el = makeFakeEl({ currentTime: 0, duration: NaN, paused: false, readyState: 0, networkState: 2 });
    const args = startupArgs(el);
    renderHook((props) => useMediaResilience(props), { initialProps: args });
    let bytes = true;
    advance(30_000, () => { if (bytes) act(() => { el._fire('progress'); }); });
    expect(args.onReload).not.toHaveBeenCalled();
    bytes = false;
    advance(SLOW_LINK_WINDOW_MS + 6000);
    expect(args.onReload).toHaveBeenCalled();
  });

  it('with metadata loaded, progress events do NOT hold the deadline (a wedge can keep downloading)', () => {
    const el = makeFakeEl({ currentTime: 0, duration: 600, paused: false, readyState: 1, networkState: 2 });
    const args = startupArgs(el);
    renderHook((props) => useMediaResilience(props), { initialProps: args });
    advance(20_000, () => { act(() => { el._fire('progress'); }); });
    expect(args.onReload).toHaveBeenCalled();
  });
});
