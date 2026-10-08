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

    expect(checkCalls()[0][1]).toEqual({ contentId: 'plex:696316', origin: 'proxy' });
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Fixing this video… · 0:0\d$/);
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
      // The refused load paused the element itself; that is not a viewer's
      // pause, so the restored file must play (2026-09-30: it sat frozen 15s).
      resumePlayback: true,
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

  it('asks once about an unlabelled media error, but starts no wait when the file is readable', async () => {
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el, 'MEDIA_ELEMENT_ERROR: Format error');
    expect(checkCalls()).toHaveLength(1);
    expect(result.current.overlayProps.sourceNotice).toBeNull();
    // A readable file with a failing stream belongs to the stall ladder: no
    // extra 'source-refusal-cleared' reload outside its budget.
    expect(args.onReload.mock.calls.map(([c]) => c.reason)).not.toContain('source-refusal-cleared');
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

  // 2026-09-29: Plex refused a Bluey part at 6:17 of 7:00, mid library scan.
  // Chromium said "Format error" / "PIPELINE_ERROR_READ" — no status — so the
  // stall ladder ran both rungs and SKIPPED the episode. The file was fine a
  // minute later; the right answer was to wait and resume at 6:17.
  describe('mid-playback refusal without an HTTP status in the error', () => {
    const playing = (el) => { el.paused = false; el.currentTime = 376.9; el.duration = 419.8; };
    const dieMidEpisode = async (el, message) => {
      await act(async () => { el._fire('playing'); });
      await advance(1000);
      await act(async () => {
        el.error = { code: message.includes('PIPELINE') ? 2 : 4, message };
        el.paused = true;
        el._fire('error');
      });
      await flush();
    };

    it('waits (no rungs, no skip) when the check says the file is refused, then resumes at the position', async () => {
      api.DaylightAPI.mockResolvedValue(answer('unreadable'));
      const el = makeFakeEl();
      playing(el);
      const args = baseArgs(el, { seconds: 376.9 });
      const { result } = renderHook(() => useMediaResilience(args));

      await dieMidEpisode(el, 'MEDIA_ELEMENT_ERROR: Format error');
      expect(result.current.overlayProps.sourceNotice).not.toBeNull();

      await advance(60_000); // far past the jolt grace and both rungs
      expect(args.onReload).not.toHaveBeenCalled();
      expect(args.onExhausted).not.toHaveBeenCalled();

      api.DaylightAPI.mockResolvedValue(answer('readable'));
      await advance(15_000);
      expect(args.onReload).toHaveBeenCalledTimes(1);
      expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'source-restored', forceRemount: true, resumePlayback: true });
      expect(args.onExhausted).not.toHaveBeenCalled();
    });

    it('keeps a viewer\'s pause: a file refused while paused is restored paused', async () => {
      api.DaylightAPI.mockResolvedValue(answer('unreadable'));
      const el = makeFakeEl();
      playing(el);
      let args = baseArgs(el, { seconds: 376.9 });
      const { rerender } = renderHook((props) => useMediaResilience(props), { initialProps: args });

      await act(async () => { el._fire('playing'); el._fire('timeupdate'); });
      await advance(1000);
      el.currentTime = 378;
      await act(async () => { el._fire('timeupdate'); });
      await advance(1000);
      // The viewer pauses; only then does the file go away.
      args = { ...args, isPaused: true };
      await act(async () => { el.paused = true; el._fire('pause'); rerender(args); });
      await flush();
      // Some time passes between the viewer's pause and the file going away
      // (in the same instant, the pause would be read as the error's own).
      await advance(2000);
      await act(async () => {
        el.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' };
        el._fire('error');
      });
      await flush();

      api.DaylightAPI.mockResolvedValue(answer('readable'));
      await advance(15_000);
      expect(args.onReload).toHaveBeenCalledTimes(1);
      expect(args.onReload.mock.calls[0][0]).toMatchObject({ reason: 'source-restored' });
      expect(args.onReload.mock.calls[0][0].resumePlayback).toBeUndefined();
    });

    it('checks before skipping when the ladder runs out, and waits instead if the file is refused', async () => {
      // The error itself looked like a readable file's failure; only by the time
      // the ladder is spent has Plex started refusing.
      api.DaylightAPI.mockResolvedValueOnce(answer('readable'));
      api.DaylightAPI.mockResolvedValue(answer('unreadable'));
      const el = makeFakeEl();
      playing(el);
      const args = baseArgs(el, { seconds: 376.9 });
      const { result } = renderHook(() => useMediaResilience(args));

      await dieMidEpisode(el, 'PipelineStatus::PIPELINE_ERROR_READ');
      await advance(90_000);

      expect(args.onReload).toHaveBeenCalled();      // the rungs did run
      expect(args.onExhausted).not.toHaveBeenCalled(); // ...but it did not skip
      expect(result.current.overlayProps.sourceNotice).not.toBeNull();
    });

    it('still skips when the ladder runs out and the file is readable (a broken stream, not a refusal)', async () => {
      api.DaylightAPI.mockResolvedValue(answer('readable'));
      const el = makeFakeEl();
      playing(el);
      const args = baseArgs(el, { seconds: 376.9 });
      renderHook(() => useMediaResilience(args));

      await dieMidEpisode(el, 'PipelineStatus::PIPELINE_ERROR_READ');
      await advance(90_000);

      expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'stall-jolt-exhausted' }));
    });
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

  // B2 (review): the code-4 element error latches until `playing`. A reload
  // after a cleared refusal that is merely SLOW must not be judged unplayable
  // off that stale latch — only the live element's own error counts.
  it('a slow reload after a cleared refusal is not judged unplayable from the latched error', async () => {
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-refusal-cleared' }));
    // The fresh URL is loading slowly: no live error, no progress yet.
    el.error = null;
    await advance(40_000);
    expect(args.onReload.mock.calls.some(([opts]) => opts?.reason === 'media-error-unplayable')).toBe(false);
    expect(args.onExhausted).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'media-error-unplayable' }));
  });
});
