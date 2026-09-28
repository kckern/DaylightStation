import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// useMediaResilience — a REFUSED source is waited out, not recovered from.
//
// Regression test for 2026-09-28: the NAS behind Plex zeroed file modes in a
// transient burst. Plex answered every direct-play request with 404, the
// <video> raised MediaError 4 ("404: Not Found"), and the recovery ladder spent
// its attempts reloading a URL that could not work, then parked on Tap to Retry
// mid-workout. Now the Player asks the backend, waits without spending the
// ledger while the file is unreadable, and reloads once when it comes back.
// ---------------------------------------------------------------------------

const api = vi.hoisted(() => ({ DaylightAPI: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => api);

import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { SOURCE_UNAVAILABLE_MAX_MS } from '../lib/sourceAvailability.js';

let fakeNow;
const installLedger = () => {
  fakeNow = 1_000_000;
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow }));
};

const flush = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
};
// Stepped a second at a time: each poll is scheduled only after the previous
// check's promise resolves, so one large synchronous jump would run just one.
const advance = async (ms) => {
  for (let left = ms; left > 0; left -= 1000) {
    const step = Math.min(1000, left);
    fakeNow += step;
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { vi.advanceTimersByTime(step); });
    // eslint-disable-next-line no-await-in-loop
    await flush();
  }
};

const answer = (state) => ({ state, contentId: 'plex:696316', steps: [] });

const baseArgs = (el, overrides = {}) => ({
  onReload: vi.fn(),
  onExhausted: vi.fn(),
  meta: { contentId: 'plex:696316', mediaType: 'video', title: 'Back 1' },
  waitKey: 'plex:696316:0',
  playbackSessionKey: `session-${Math.random()}`,
  disabled: false,
  getMediaEl: () => el,
  seconds: 0,
  isPaused: false,
  isSeeking: false,
  pauseIntent: null,
  mediaTypeHint: 'video',
  ...overrides,
});

const refuse = async (el, message = '404: Not Found') => {
  await act(async () => {
    el.error = { code: 4, message };
    el._fire('error');
  });
  await flush();
};

const checkCalls = () => api.DaylightAPI.mock.calls.filter(([path]) => path === 'api/v1/media-source/check');

beforeEach(() => {
  vi.useFakeTimers();
  api.DaylightAPI.mockReset();
  installLedger();
});
afterEach(() => {
  vi.useRealTimers();
  _setSharedLedgerForTests(null);
});

describe('useMediaResilience — refused source', () => {
  it('waits without reloading while the file is unreadable, then resumes once', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    await refuse(el);

    expect(checkCalls()[0][1]).toEqual({ contentId: 'plex:696316' });
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Video file unavailable — retrying · 0:0\d$/);
    expect(result.current.overlayProps.shouldRender).toBe(true);

    // Two minutes of refusal: well past the 15s startup deadline and the jolt
    // grace. Nothing reloads, and the backend is polled on the backoff.
    await advance(120_000);
    expect(args.onReload).not.toHaveBeenCalled();
    expect(args.onExhausted).not.toHaveBeenCalled();
    expect(checkCalls().length).toBeGreaterThanOrEqual(8);
    expect(checkCalls().length).toBeLessThanOrEqual(14);
    expect(result.current.overlayProps.sourceNotice).toMatch(/· 2:0\d$/);

    api.DaylightAPI.mockResolvedValue(answer('readable'));
    await advance(15_000);

    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload.mock.calls[0][0]).toMatchObject({
      reason: 'source-restored', refreshUrl: true, forceRemount: true,
    });
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });

  it('reloads straight away when the refusal has already cleared', async () => {
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    await refuse(el, '503: Service Unavailable');

    expect(args.onReload).toHaveBeenCalledTimes(1);
    expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'source-refusal-cleared', refreshUrl: true });
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });

  it('leaves a genuinely missing file to the ordinary ladder', async () => {
    api.DaylightAPI.mockResolvedValue(answer('missing'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    await refuse(el);
    expect(result.current.overlayProps.sourceNotice).toBeNull();
    expect(checkCalls()).toHaveLength(1);
  });

  it('does not start a wait for a decode error', async () => {
    const el = makeFakeEl({ paused: true });
    renderHook(() => useMediaResilience(baseArgs(el)));
    await refuse(el, 'MEDIA_ELEMENT_ERROR: Format error');
    expect(checkCalls()).toHaveLength(0);
  });

  it('asks before recovering when the startup deadline fires, and holds on unreadable', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    // No error event at all — the element simply never produced a frame.
    await advance(20_000);

    expect(checkCalls().length).toBeGreaterThanOrEqual(1);
    expect(args.onReload).not.toHaveBeenCalled();
    expect(result.current.overlayProps.sourceNotice).not.toBeNull();
  });

  it('falls back to the ordinary exhausted state after the maximum wait', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    await refuse(el);
    await advance(SOURCE_UNAVAILABLE_MAX_MS + 30_000);

    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-unavailable-gave-up' }));
    expect(result.current.overlayProps.isExhausted).toBe(true);
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });

  it('keeps waiting when the check itself fails mid-outage (backend restarting)', async () => {
    api.DaylightAPI.mockResolvedValueOnce(answer('unreadable'));
    api.DaylightAPI.mockRejectedValue(new Error('Network error: request failed'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));

    await refuse(el);
    await advance(60_000);

    expect(result.current.overlayProps.sourceNotice).not.toBeNull();
    expect(args.onReload).not.toHaveBeenCalled();
  });
});
