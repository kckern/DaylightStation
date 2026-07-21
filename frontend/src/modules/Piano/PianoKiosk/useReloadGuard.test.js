import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useReloadGuard } from './useReloadGuard.js';

afterEach(() => vi.restoreAllMocks());

describe('useReloadGuard', () => {
  it('is a no-op: never installs a beforeunload handler, active or not', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const { rerender, unmount } = renderHook(({ a }) => useReloadGuard(a), { initialProps: { a: false } });
    rerender({ a: true });
    expect(add).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    rerender({ a: false });
    unmount();
  });
});
