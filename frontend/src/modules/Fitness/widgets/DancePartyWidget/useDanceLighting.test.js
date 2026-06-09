import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const post = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: (...args) => post(...args) }));

import { useDanceLighting } from './useDanceLighting.js';

describe('useDanceLighting', () => {
  beforeEach(() => post.mockClear());

  it('posts start on mount and stop on unmount', () => {
    const { unmount } = renderHook(() => useDanceLighting({ enabled: true }));
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/start', {}, 'POST');
    post.mockClear();
    unmount();
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/stop', {}, 'POST');
  });

  it('accent() posts an accent', () => {
    const { result } = renderHook(() => useDanceLighting({ enabled: true }));
    post.mockClear();
    act(() => result.current.accent());
    expect(post).toHaveBeenCalledWith('api/v1/fitness/dance/accent', {}, 'POST');
  });

  it('does nothing when disabled', () => {
    const { result, unmount } = renderHook(() => useDanceLighting({ enabled: false }));
    act(() => result.current.accent());
    unmount();
    expect(post).not.toHaveBeenCalled();
  });
});
