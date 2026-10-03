import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// RELY.5a ruling (2026-10-03): the refused-source wait is reported to the
// owner, and its maximum is an owner option (`monitor.sourceUnavailableMaxMs`)
// so Media can give up after 60 s while Fitness/kiosks keep the 30-minute wait.

const api = vi.hoisted(() => ({ DaylightAPI: vi.fn() }));
vi.mock('../../../lib/api.mjs', () => api);

import { useMediaResilience } from './useMediaResilience.js';
import { useResilienceConfig } from './useResilienceConfig.js';
import { createRecoveryLedger, _setSharedLedgerForTests } from '../lib/recoveryLedger.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';
import { SOURCE_UNAVAILABLE_MAX_MS } from '../lib/sourceAvailability.js';

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
const answer = (state) => ({ state, contentId: 'plex:696316', steps: [] });
const baseArgs = (el, overrides = {}) => ({
  onReload: vi.fn(), onExhausted: vi.fn(), onSourceWait: vi.fn(),
  meta: { contentId: 'plex:696316', mediaType: 'video', title: 'Back 1' },
  waitKey: 'plex:696316:0', playbackSessionKey: `session-${Math.random()}`,
  disabled: false, getMediaEl: () => el, seconds: 0, isPaused: false, isSeeking: false,
  pauseIntent: null, mediaTypeHint: 'video', ...overrides,
});
const refuse = async (el) => {
  await act(async () => { el.error = { code: 4, message: '503: Service Unavailable' }; el._fire('error'); });
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

describe('source wait — owner option and reporting', () => {
  it('exposes sourceUnavailableMaxMs as a monitor option, defaulting to 30 minutes', () => {
    const { result: def } = renderHook(() => useResilienceConfig({}));
    expect(def.current.monitorSettings.sourceUnavailableMaxMs).toBe(SOURCE_UNAVAILABLE_MAX_MS);
    const { result: media } = renderHook(() => useResilienceConfig({ configOverrides: { monitor: { sourceUnavailableMaxMs: 60_000 } } }));
    expect(media.current.monitorSettings.sourceUnavailableMaxMs).toBe(60_000);
  });

  it('gives up at the owner maximum (60 s), not at the next 15 s poll after it', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el, { configOverrides: { monitor: { sourceUnavailableMaxMs: 60_000 } } });
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(57_000);
    expect(args.onExhausted).not.toHaveBeenCalled();
    await advance(5_000);
    expect(args.onExhausted).toHaveBeenCalledWith(expect.objectContaining({ reason: 'source-unavailable-gave-up' }));
  });

  it('reports the wait to the owner when it opens and when it ends', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    expect(args.onSourceWait).toHaveBeenCalledWith(expect.objectContaining({ waiting: true, since: expect.any(Number) }));
    api.DaylightAPI.mockResolvedValue(answer('readable'));
    await advance(4_000);
    expect(args.onSourceWait).toHaveBeenLastCalledWith(expect.objectContaining({ waiting: false }));
  });

  it('keeps the 30-minute default when no owner option is given', async () => {
    api.DaylightAPI.mockResolvedValue(answer('unreadable'));
    const el = makeFakeEl({ paused: true });
    const args = baseArgs(el);
    renderHook(() => useMediaResilience(args));
    await refuse(el);
    await advance(120_000);
    expect(args.onExhausted).not.toHaveBeenCalled();
  });
});
