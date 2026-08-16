import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({
  playbackLog: vi.fn(),
  default: vi.fn()
}));

import { useMediaResilience } from './useMediaResilience.js';
import { makeFakeEl } from './__testHelpers/fakeMediaEl.js';

// `mediaDetails.hasElement` was the literal `true`. The loading overlay branches
// on it to choose `el:t=… r=… n=… p=…` over `el:none`, so the `el:` prefix
// asserted an element existed and nothing had checked. During the 2026-08-16
// remount storm the overlay reported an element on every tick, including the
// ticks where the <video> had been torn out and not yet replaced.
describe('useMediaResilience — mediaDetails.hasElement is a check, not a claim', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('is false when there is no element', () => {
    const { result } = renderHook(() =>
      useMediaResilience({ getMediaEl: () => null, waitKey: 'k1' })
    );
    expect(result.current.overlayProps.mediaDetails.hasElement).toBe(false);
    expect(result.current.overlayProps.mediaDetails.elTag).toBeNull();
    expect(result.current.overlayProps.mediaDetails.elSource).toBe('none');
  });

  it('is true when there is one, and names it', () => {
    const el = makeFakeEl({ currentTime: 3, duration: 120, tagName: 'DASH-VIDEO' });
    const { result } = renderHook(() =>
      useMediaResilience({ getMediaEl: () => el, waitKey: 'k1' })
    );
    expect(result.current.overlayProps.mediaDetails.hasElement).toBe(true);
    expect(result.current.overlayProps.mediaDetails.elTag).toBe('dash-video');
    expect(result.current.overlayProps.mediaDetails.elSource).toBe('container');
  });

  // Re-renders with EVERY prop unchanged, so the only thing that can move the
  // reported value is the element read itself. Change `seconds` as well and the
  // memo recomputes for that reason instead, which would let a missing
  // dependency pass as if it were wired.
  it('follows the element disappearing, with no other prop moving', () => {
    const holder = { current: makeFakeEl({ currentTime: 3, tagName: 'VIDEO' }) };
    const { result, rerender } = renderHook(() =>
      useMediaResilience({ getMediaEl: () => holder.current, waitKey: 'k1', seconds: 1 })
    );
    expect(result.current.overlayProps.mediaDetails.hasElement).toBe(true);

    holder.current = null;
    rerender();
    expect(result.current.overlayProps.mediaDetails.hasElement).toBe(false);
    expect(result.current.overlayProps.mediaDetails.elTag).toBeNull();
  });
});
