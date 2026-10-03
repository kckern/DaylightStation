import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// RELY.5a diagnosis (2026-10-03, retained trace in the Task 7 evidence): a
// recovery remount whose load fails ("MEDIA_ELEMENT_ERROR: Format error",
// readyState 0) leaves the element paused. That pause was read as the
// VIEWER's, so userIntent went `paused`, the monitoring effect hard-returned,
// no deadline re-armed and the item sat on "Recovering…" forever — no
// exhaustion, so an owner never got to skip it. A pause while the Player
// itself is recovering is the failed load's, not a person's.

const api = vi.hoisted(() => ({ DaylightAPI: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => api);

import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

let fakeNow;
const flush = async () => { for (let i = 0; i < 5; i += 1) { await act(async () => { await Promise.resolve(); }); } };
const advance = async (ms) => {
  for (let left = ms; left > 0; left -= 1000) {
    const step = Math.min(1000, left);
    fakeNow += step;
    await act(async () => { vi.advanceTimersByTime(step); });
    await flush();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  fakeNow = 1_000_000;
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow }));
  api.DaylightAPI.mockResolvedValue({ state: 'readable', contentId: 'plex:55854', steps: [] });
});
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('a pause caused by a failed recovery load', () => {
  it('keeps the ladder armed until it exhausts, instead of hanging on Recovering…', async () => {
    // Each remount is a fresh element, as in the real Player.
    let current = makeFakeEl({ paused: false, currentTime: 4190, duration: 6982 });
    const args = {
      onReload: vi.fn(), onExhausted: vi.fn(),
      meta: { contentId: 'plex:55854', mediaType: 'video', title: 'Arrival' },
      waitKey: 'plex:55854:0', playbackSessionKey: 'session-recovery-pause',
      disabled: false, getMediaEl: () => current, seconds: 4190, isPaused: false, isSeeking: false,
      pauseIntent: null, mediaTypeHint: 'video', registrationSignal: {},
    };
    const { result, rerender } = renderHook((props) => useMediaResilience(props), { initialProps: args });
    act(() => { current._fire('playing'); });
    await advance(1000);

    const remountAndFail = async (waitKey) => {
      current = makeFakeEl({ paused: true, currentTime: 0, duration: 6982 });
      current.readyState = 0;
      rerender({ ...args, waitKey, isPaused: true, seconds: 0, registrationSignal: {} });
      await flush();
      await act(async () => {
        current.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' };
        current._fire('error');
        current._fire('pause');
      });
      await flush();
    };

    // The stall ladder remounts, and the remounted load fails…
    await act(async () => { result.current.requestRecovery('stall-jolt-remount', { forceRemount: true, bypassCooldown: true }); });
    await flush();
    await remountAndFail('plex:55854:1');
    // …one fresh-URL remount is tried, and it fails the same way.
    expect(args.onReload.mock.calls.some(([opts]) => opts?.reason === 'media-error-unplayable' && opts?.forceRemount === true)).toBe(true);
    await remountAndFail('plex:55854:2');

    await advance(60_000);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'media-error-unplayable', attempts: expect.any(Number) }));
  });

  // B1 (review): a REAL viewer pause during an ordinary network stall must
  // stand — the ladder must not keep running and auto-skip mid-workout.
  it('a viewer pause during recovery with no media error stops the ladder', async () => {
    const el = makeFakeEl({ paused: false, currentTime: 100, duration: 2000 });
    const args = {
      onReload: vi.fn(), onExhausted: vi.fn(),
      meta: { contentId: 'plex:55854', mediaType: 'video', title: 'Arrival' },
      waitKey: 'plex:55854:0', playbackSessionKey: 'session-viewer-pause',
      disabled: false, getMediaEl: () => el, seconds: 100, isPaused: false, isSeeking: false,
      pauseIntent: null, mediaTypeHint: 'video',
    };
    const { result, rerender } = renderHook((props) => useMediaResilience(props), { initialProps: args });
    act(() => { el._fire('playing'); });
    await advance(1000);
    // A new load cycle that has not produced progress yet, under recovery.
    rerender({ ...args, waitKey: 'plex:55854:1' });
    await flush();
    await act(async () => { result.current.requestRecovery('stall-jolt-remount', { forceRemount: true, bypassCooldown: true }); });
    await flush();
    expect(result.current.overlayProps.isRecovering ?? true).toBe(true);
    const reloadsAtPause = args.onReload.mock.calls.length;
    // The person pauses; no error on the element.
    await act(async () => { el.paused = true; el._fire('pause'); });
    rerender({ ...args, waitKey: 'plex:55854:1', isPaused: true });
    await flush();
    await advance(180_000);
    expect(args.onReload.mock.calls.length).toBe(reloadsAtPause);
    expect(args.onExhausted).not.toHaveBeenCalled();
  });
});
