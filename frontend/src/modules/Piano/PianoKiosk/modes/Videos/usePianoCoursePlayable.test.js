import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a) }));

import { usePianoCoursePlayable } from './usePianoCoursePlayable.js';

beforeEach(() => { api.mockReset(); });

describe('usePianoCoursePlayable', () => {
  it('calls piano endpoint when userId provided', async () => {
    api.mockResolvedValue({ items: [], info: {}, isSequential: false });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).toHaveBeenCalledWith('api/v1/piano/courses/12345/playable?userId=alice');
  });

  it('falls back to fitness endpoint when no userId', async () => {
    api.mockResolvedValue({ items: [], info: {} });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).toHaveBeenCalledWith('api/v1/fitness/show/12345/playable');
  });

  it('exposes isSequential from response', async () => {
    api.mockResolvedValue({ items: [{ plex: '1' }], info: { title: 'X' }, parents: {}, isSequential: true });
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isSequential).toBe(true);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.info.title).toBe('X');
  });

  it('exposes error state on fetch failure', async () => {
    api.mockRejectedValue(new Error('network error'));
    const { result } = renderHook(() => usePianoCoursePlayable('12345', 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('network error');
  });

  it('does not fetch when courseId is falsy', async () => {
    const { result } = renderHook(() => usePianoCoursePlayable(null, 'alice'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(api).not.toHaveBeenCalled();
    expect(result.current.items).toBe(null);
  });
});
