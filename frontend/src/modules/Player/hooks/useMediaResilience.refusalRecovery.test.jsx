import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// 2026-10-07 (Bluey on the living-room Shield): a refused episode was never
// healed because (A) the backend was asked about the queue ROOT, (D) an HLS
// refusal never reached the resilience hook, and the screen then auto-skipped.
// Owner ruling: screens HOLD until healed.

const api = vi.hoisted(() => ({ DaylightAPI: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => api);

import { useMediaResilience } from './useMediaResilience.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { HLS_REFUSAL_EVENT } from '../lib/hlsRefusal.js';

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
const answer = (state, extra = {}) => ({ state, steps: [], ...extra });
const baseArgs = (el, overrides = {}) => ({
  onReload: vi.fn(), onExhausted: vi.fn(), onSourceWait: vi.fn(),
  // /play responses carry id/assetId (not contentId); plexId is the queue ROOT.
  meta: { id: 'plex:59546', assetId: 'plex:59546', mediaType: 'video', title: 'Ticklecrabs' },
  plexId: '59493',
  waitKey: 'plex:59546:0', playbackSessionKey: `session-${Math.random()}`,
  disabled: false, getMediaEl: () => el, seconds: 0, isPaused: false, isSeeking: false,
  pauseIntent: null, mediaTypeHint: 'video', ...overrides,
});
const refuse = async (el, message = '503: Service Unavailable') => {
  await act(async () => { el.error = { code: 4, message }; el._fire('error'); });
  await flush();
};
const fireHls = async (el, detail) => {
  await act(async () => { (el._listeners[HLS_REFUSAL_EVENT] || []).forEach((fn) => fn({ detail })); });
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  api.DaylightAPI.mockReset();
  fakeNow = 1_000_000;
  vi.setSystemTime(fakeNow);
  _setSharedLedgerForTests(createRecoveryLedger({ now: () => fakeNow }));
});
afterEach(() => { vi.useRealTimers(); _setSharedLedgerForTests(null); });

describe('leaf identity', () => {
  it('asks the backend about the playing episode, never the queue-root plexId', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    renderHook(() => useMediaResilience(baseArgs(el)));
    await refuse(el);
    const call = api.DaylightAPI.mock.calls.find(([url]) => url === 'api/v1/media-source/check');
    expect(call[1].contentId).toBe('plex:59546');
    expect(JSON.stringify(api.DaylightAPI.mock.calls)).not.toContain('59493');
  });

  it('tells the backend a proxied refusal was seen (origin: proxy) for a confirmed 503', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    renderHook(() => useMediaResilience(baseArgs(el)));
    await refuse(el, '503: Service Unavailable');
    expect(api.DaylightAPI.mock.calls[0][1]).toMatchObject({ contentId: 'plex:59546', origin: 'proxy' });
  });

  it('does not claim a proxied refusal for an unlabelled error', async () => {
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    const el = makeFakeEl({ paused: true });
    renderHook(() => useMediaResilience(baseArgs(el)));
    await refuse(el, 'MEDIA_ELEMENT_ERROR: Format error');
    expect(api.DaylightAPI.mock.calls[0][1].origin).toBeUndefined();
  });
});

describe('HLS refusal joins the path', () => {
  it('a segment refusal event asks the backend, waits, and resumes at the saved spot when readable', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ currentTime: 183, duration: 420 });
    const args = baseArgs(el, { seconds: 183 });
    const { result } = renderHook(() => useMediaResilience(args));
    await fireHls(el, { status: 404, details: 'fragLoadError', urlKind: 'segment', fatal: false, count: 2 });
    expect(api.DaylightAPI).toHaveBeenCalledWith('api/v1/media-source/check', expect.objectContaining({ contentId: 'plex:59546' }), 'POST');
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Fixing this video… · 0:0\d$/);
    expect(args.onSourceWait).toHaveBeenCalledWith(expect.objectContaining({ waiting: true }));

    api.DaylightAPI.mockResolvedValue(answer('readable'));
    await advance(4_000);
    expect(args.onReload).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-restored', refreshUrl: true, forceRemount: true }));
  });

  it('a readable answer to an HLS suspicion hands back to the stall ladder (no extra reload)', async () => {
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    const el = makeFakeEl({ currentTime: 10, duration: 420 });
    const args = baseArgs(el);
    renderHook(() => useMediaResilience(args));
    await fireHls(el, { status: 503, details: 'fragLoadError', urlKind: 'segment', fatal: true, count: 1 });
    expect(args.onReload).not.toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-refusal-cleared' }));
    expect(args.onExhausted).not.toHaveBeenCalled();
  });
});

describe('screens hold (no auto-skip on refusal)', () => {
  it('a confirmed refusal the backend cannot judge keeps waiting for the first polls', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unknown', { reason: 'not-a-leaf' }));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(8_000);
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Fixing this video…/);
    expect(args.onExhausted).not.toHaveBeenCalled();
  });

  it('...but a deleted item (no-metadata, four times) is treated as missing, not waited 30 minutes', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unknown', { reason: 'no-metadata' }));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(60_000);
    expect(result.current.overlayProps.sourceNotice).toBeFalsy();
  });

  it('a Plex outage (reasonless unknown, many polls) is NOT a deleted item: the screen keeps waiting', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unknown'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(60_000);
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Fixing this video…/);
  });

  it('a failed check (backend down) keeps a screen waiting too', async () => {
    api.DaylightAPI.mockRejectedValue(new Error('backend restarting'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(120_000);
    expect(result.current.overlayProps.sourceNotice).toMatch(/^Fixing this video…/);
    expect(args.onExhausted).not.toHaveBeenCalled();
  });

  it('at the 30-minute cap it reports gave-up (the Player then HOLDS, see Player.holdOnRefusal)', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(29 * 60_000);
    expect(args.onExhausted).not.toHaveBeenCalled();
    await advance(2 * 60_000);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-unavailable-gave-up' }));
  });

  it('without the option (unchanged behaviour) an unknown answer is left to the ordinary ladder', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unknown'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });

  it('an UNLABELLED error with an unknown answer is not a confirmed refusal: fitness/piano/school ladders run as documented', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unknown'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el, 'MEDIA_ELEMENT_ERROR: Format error');
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });

  it('a missing file is never held (ordinary ladder / skip applies)', async () => {
    api.DaylightAPI.mockResolvedValue(answer('missing'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { holdOnRefusal: true });
    const { result } = renderHook(() => useMediaResilience(args));
    await refuse(el);
    expect(result.current.overlayProps.sourceNotice).toBeNull();
  });
});

describe('Media phones keep 60 s', () => {
  it('a 60 s owner cap still gives up at 60 s', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { configOverrides: { monitor: { sourceUnavailableMaxMs: 60_000 } } });
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(62_000);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-unavailable-gave-up' }));
  });
});
