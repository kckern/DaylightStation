import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { STALL_JOLT_GRACE_MS, STALL_JOLT_STEP_MS } from '../lib/stallJolt.js';
import { SLOW_LINK_WINDOW_MS, SLOW_LINK_FROZEN_AHEAD_SEC } from '../lib/bufferProgress.js';

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

// An element frozen at the buffer edge while the download trickles in. Rates
// are media seconds buffered per wall second (the 2026-10-28 link ran ~0.3).
const slowEl = ({ currentTime = 300, ahead = 0.2 } = {}) => {
  const state = { end: currentTime + ahead, on: true };
  const el = makeFakeEl({ currentTime, duration: 1800, paused: false, seeking: false, readyState: 2, networkState: 2 });
  Object.defineProperty(el, 'buffered', {
    get: () => ({ length: 1, start: () => 0, end: () => state.end }),
  });
  return { el, state };
};

const renderStuck = (el) => {
  const args = {
    onReload: vi.fn(), onExhausted: vi.fn(),
    meta: { src: 'https://example.test/stream/1', mediaKey: 'plex:1' },
    waitKey: 'wk-1', playbackSessionKey: 'session-slow-link', disabled: false,
    getMediaEl: () => el, seconds: 0, externalStalled: false,
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
    const { el, state } = slowEl();
    const { args, hook } = renderStuck(el);
    const grow = (ms) => { if (state.on) state.end += 0.15 * (ms / 1000); };
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS * 3, grow); // ahead ≈ 4.3 s
    expect(args.onReload).not.toHaveBeenCalled();
    expect(args.onExhausted).not.toHaveBeenCalled();
    expect(ledger.snapshot(args.playbackSessionKey)?.count ?? 0).toBe(0);
    expect(hook.result.current.overlayProps.linkNotice).toMatch(/slow connection/i);
  });

  it('a buffer that stops growing is stuck again: the ladder resumes within a window', () => {
    const { el, state } = slowEl();
    const { args, hook } = renderStuck(el);
    const grow = (ms) => { if (state.on) state.end += 0.15 * (ms / 1000); };
    advance(STALL_JOLT_GRACE_MS + 4000, grow);
    expect(args.onReload).not.toHaveBeenCalled();
    state.on = false;
    advance(SLOW_LINK_WINDOW_MS + 2500, grow);
    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'stall-jolt-refresh-url' }));
    expect(hook.result.current.overlayProps.linkNotice).toBeNull();
  });

  it('a hold ends when a frozen playhead has passed the frozen-ahead mark (bounded wait)', () => {
    const { el, state } = slowEl();
    const { args, hook } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS + 4000, (ms) => { state.end += 0.15 * (ms / 1000); });
    expect(args.onReload).not.toHaveBeenCalled();
    expect(hook.result.current.overlayProps.linkNotice).toMatch(/slow connection/i);
    // Keep downloading with the playhead frozen: a wedge, not a slow link.
    advance(30_000, (ms) => { state.end += 0.15 * (ms / 1000); });
    expect(args.onReload).toHaveBeenCalled();
  });

  it('readyState HAVE_FUTURE_DATA while frozen is a wedge — jolts at the grace boundary', () => {
    const { el, state } = slowEl();
    el.readyState = 3;
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS, (ms) => { state.end += 0.15 * (ms / 1000); });
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a frozen playhead with plenty buffered is a wedge, not a slow link — jolts as before', () => {
    const { el, state } = slowEl({ ahead: SLOW_LINK_FROZEN_AHEAD_SEC + 2 });
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS, (ms) => { state.end += 0.3 * (ms / 1000); });
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });

  it('a frozen playhead whose download keeps going (decoder wedge) jolts once the buffer passes the frozen-ahead mark', () => {
    const { el, state } = slowEl();
    const { args } = renderStuck(el);
    // Playhead frozen; the download carries on at 0.6x: ahead crosses 5s at ~8s.
    advance(STALL_JOLT_GRACE_MS + STALL_JOLT_STEP_MS, (ms) => { state.end += 0.6 * (ms / 1000); });
    expect(args.onReload).toHaveBeenCalled();
  });

  it('an unbuffered, not-growing stall still jolts at the grace boundary (no regression)', () => {
    const { el } = slowEl();
    const { args } = renderStuck(el);
    advance(STALL_JOLT_GRACE_MS);
    expect(args.onReload).toHaveBeenCalledTimes(1);
  });
});
