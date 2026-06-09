import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useZoomState from './useZoomState.js';

const setup = (overrides = {}) =>
  renderHook(() => useZoomState({ baseDuration: 1000, ...overrides }));

describe('useZoomState — core navigation', () => {
  it('starts at root (not zoomed)', () => {
    const { result } = setup();
    expect(result.current.isZoomed).toBe(false);
    expect(result.current.zoomRange).toBeNull();
  });

  it('zoomIn enters a zoomed range; zoomOut returns to root immediately', () => {
    const { result } = setup();
    act(() => result.current.zoomIn([100, 200]));
    expect(result.current.isZoomed).toBe(true);
    expect(result.current.zoomRange).toEqual([100, 200]);
    act(() => result.current.zoomOut());
    expect(result.current.isZoomed).toBe(false);
    expect(result.current.zoomRange).toBeNull();
  });

  it('ignores a disabled zoomIn', () => {
    const { result } = setup({ disabled: true });
    act(() => result.current.zoomIn([100, 200]));
    expect(result.current.isZoomed).toBe(false);
  });
});
