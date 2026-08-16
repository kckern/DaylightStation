import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const daylightAPI = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => daylightAPI(...args) }));
vi.mock('../../../lib/logging/Logger.js', () => {
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child: () => logger };
  return { default: () => logger };
});

import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';

describe('usePreviewScreens', () => {
  beforeEach(() => { daylightAPI.mockReset(); });

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
    expect(result.current.screens).toEqual([FALLBACK_SCREEN]);
  });

  it('falls back rather than throwing when the request fails', async () => {
    daylightAPI.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => usePreviewScreens());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.screens).toEqual([FALLBACK_SCREEN]);
  });

  it('ships a fallback that is generic, never a household screen id', () => {
    expect(FALLBACK_SCREEN.resolution).toEqual({ width: 1280, height: 720 });
    expect(FALLBACK_SCREEN.id.startsWith('__')).toBe(true);
  });
});
