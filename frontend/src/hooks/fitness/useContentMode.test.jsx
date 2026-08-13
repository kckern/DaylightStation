// frontend/src/hooks/fitness/useContentMode.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockApi = vi.fn();
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => mockApi(...args) }));
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) })
}));

const { useContentMode, __clearContentModeCache } = await import('./useContentMode.js');

const CFG = { no_capture_labels: ['Instructional'], study_ux_labels: ['Instructional'] };

beforeEach(() => {
  mockApi.mockReset();
  __clearContentModeCache();
});

describe('useContentMode', () => {
  it('resolves synchronously when the item already carries labels', () => {
    const { result } = renderHook(() => useContentMode({ labels: ['instructional'] }, CFG));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('reports unresolved before the backstop fetch settles', () => {
    mockApi.mockReturnValue(new Promise(() => {})); // never settles
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    expect(result.current.resolved).toBe(false);
    expect(result.current.captureDisabled).toBe(false);
  });

  it('resolves from fetched show labels when the item has none', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(result.current.resolved).toBe(true));
    expect(result.current).toEqual({ captureDisabled: true, studyUx: true, resolved: true });
    expect(mockApi).toHaveBeenCalledWith('api/v1/fitness/show/696065');
  });

  it('stays unresolved when the backstop fetch fails — capture must not start', async () => {
    mockApi.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    expect(result.current.resolved).toBe(false);
  });

  it('caches by show id — a second item from the same show does not refetch', async () => {
    mockApi.mockResolvedValue({ info: { labels: ['instructional'] } });
    const { result: r1 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r1.current.resolved).toBe(true));
    const { result: r2 } = renderHook(() => useContentMode({ grandparentId: '696065' }, CFG));
    await waitFor(() => expect(r2.current.resolved).toBe(true));
    expect(mockApi).toHaveBeenCalledTimes(1);
  });

  it('resolves immediately when there is no item at all', () => {
    const { result } = renderHook(() => useContentMode(null, CFG));
    expect(result.current).toEqual({ captureDisabled: false, studyUx: false, resolved: true });
  });
});
