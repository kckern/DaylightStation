import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useUpscaleEffects } from './useUpscaleEffects.js';

// The CRT is for SUB-SD sources: narrower than 640 AND shorter than 480. Height
// alone was wrong — a 768x432 widescreen file (2026-10-09, Baby Joy Joy) is SD.
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

  it('leaves widescreen SD clean even when it is shorter than 480 lines', () => {
    expect(showCrtFor(768, 432)).toBe(false);
    expect(showCrtFor(854, 480)).toBe(false);
    expect(showCrtFor(640, 480)).toBe(false);
    expect(showCrtFor(640, 360)).toBe(false);
  });

  it('applies the CRT to sub-SD sources', () => {
    expect(showCrtFor(480, 360)).toBe(true);
    expect(showCrtFor(320, 240)).toBe(true);
  });

  it('leaves a 640-wide source clean at any height under 480', () => {
    expect(showCrtFor(640, 479)).toBe(false);
  });
});
