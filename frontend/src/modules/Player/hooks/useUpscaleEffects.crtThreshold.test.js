import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUpscaleEffects } from './useUpscaleEffects.js';

// 480p is the smallest source left clean: the CRT is only for sources strictly
// shorter than 480 lines.
function fakeVideo(width, height) {
  const el = document.createElement('video');
  Object.defineProperty(el, 'videoWidth', { value: width });
  Object.defineProperty(el, 'videoHeight', { value: height });
  el.getBoundingClientRect = () => ({ width: 1920, height: 1080 });
  return el;
}

function showCrtFor(width, height) {
  const mediaRef = { current: fakeVideo(width, height) };
  const { result } = renderHook(() => useUpscaleEffects({ mediaRef, stabilizeMs: 10 }));
  act(() => { vi.advanceTimersByTime(20); });
  return result.current.overlayProps.showCRT;
}

describe('useUpscaleEffects CRT threshold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('leaves a 480p source clean', () => {
    expect(showCrtFor(720, 480)).toBe(false);
  });

  it('applies the CRT to a source below 480 lines', () => {
    expect(showCrtFor(640, 479)).toBe(true);
    expect(showCrtFor(640, 360)).toBe(true);
  });
});
