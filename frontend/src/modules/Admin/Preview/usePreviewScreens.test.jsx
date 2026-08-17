import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const daylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => daylightAPI(...args) }));

// Spies, not no-ops: the handlers log before they touch state, so a log call is
// the observable proof that a handler ran past its `cancelled` guard. React
// no-ops setState after unmount and RTL freezes `result.current` at the last
// render, so state alone cannot distinguish a guarded handler from an unguarded
// one — asserting only on state would pass either way.
const logSpy = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = { ...logSpy, child: () => logger };
  return { default: () => logger };
});

import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';

describe('usePreviewScreens', () => {
  beforeEach(() => {
    daylightAPI.mockReset();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  /** Let the pending promise's `.then` handlers run. */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('returns only screens that declare a usable resolution', async () => {
    daylightAPI.mockResolvedValue({ screens: [
      { id: 'living-room', name: 'Living Room', resolution: { width: 960, height: 540 } },
      { id: 'kitchen-eink', name: 'Kitchen', resolution: null },
      { id: 'office', name: 'Office', resolution: { width: 1280, height: 720 } },
    ] });

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens.map((s) => s.id)).toEqual(['living-room', 'office']);
  });

  it('rejects a degenerate resolution the frame builder could not scale', async () => {
    daylightAPI.mockResolvedValue({ screens: [
      { id: 'zero-width', name: 'Zero', resolution: { width: 0, height: 540 } },
      { id: 'negative', name: 'Negative', resolution: { width: -1280, height: -720 } },
      { id: 'office', name: 'Office', resolution: { width: 1280, height: 720 } },
    ] });

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens.map((s) => s.id)).toEqual(['office']);
  });

  it('falls back to a generic screen when the API returns nothing sized', async () => {
    daylightAPI.mockResolvedValue({ screens: [{ id: 'kitchen-eink', name: 'Kitchen', resolution: null }] });

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens[0]).toBe(FALLBACK_SCREEN);
    expect(result.current.screens).toHaveLength(1);
  });

  it('falls back rather than throwing when the request fails', async () => {
    daylightAPI.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens[0]).toBe(FALLBACK_SCREEN);
    expect(result.current.screens).toHaveLength(1);
  });

  it('does not write state after unmount when the request resolves', async () => {
    let resolve;
    daylightAPI.mockReturnValue(new Promise((r) => { resolve = r; }));

    const { result, unmount } = renderHook(() => usePreviewScreens());
    unmount();
    resolve({ screens: [{ id: 'office', name: 'Office', resolution: { width: 1280, height: 720 } }] });
    await flush();

    expect(logSpy.debug).not.toHaveBeenCalled();
    expect(result.current.screens).toEqual([FALLBACK_SCREEN]);
    expect(result.current.loading).toBe(true);
  });

  it('does not write state after unmount when the request rejects', async () => {
    let reject;
    daylightAPI.mockReturnValue(new Promise((_, r) => { reject = r; }));

    const { result, unmount } = renderHook(() => usePreviewScreens());
    unmount();
    reject(new Error('boom'));
    await flush();

    expect(logSpy.warn).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('ships a fallback that is generic, never a household screen id', () => {
    expect(Object.isFrozen(FALLBACK_SCREEN)).toBe(true);
    expect(Object.isFrozen(FALLBACK_SCREEN.resolution)).toBe(true);
    expect(FALLBACK_SCREEN.id.startsWith('__')).toBe(true);
  });
});
