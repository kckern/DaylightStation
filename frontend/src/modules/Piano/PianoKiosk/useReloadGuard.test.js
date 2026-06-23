import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useReloadGuard } from './useReloadGuard.js';

afterEach(() => vi.restoreAllMocks());

describe('useReloadGuard', () => {
  it('adds beforeunload only when active, and removes it on deactivate/unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender, unmount } = renderHook(({ a }) => useReloadGuard(a), { initialProps: { a: false } });
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    rerender({ a: true });
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    rerender({ a: false });
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    unmount();
  });
});
