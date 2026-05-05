import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChallengeOverlayPosition, CHALLENGE_OVERLAY_POSITION_KEY }
  from './useChallengeOverlayPosition.js';

describe('useChallengeOverlayPosition', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage?.clear?.();
  });

  it('defaults to "top" when no value is stored', () => {
    const { result } = renderHook(() => useChallengeOverlayPosition());
    expect(result.current.position).toBe('top');
  });

  it('reads a previously stored position from localStorage', () => {
    window.localStorage.setItem(CHALLENGE_OVERLAY_POSITION_KEY, 'middle');
    const { result } = renderHook(() => useChallengeOverlayPosition());
    expect(result.current.position).toBe('middle');
  });

  it('cyclePosition() advances top → middle → bottom → top', () => {
    const { result } = renderHook(() => useChallengeOverlayPosition());
    expect(result.current.position).toBe('top');
    act(() => result.current.cyclePosition());
    expect(result.current.position).toBe('middle');
    act(() => result.current.cyclePosition());
    expect(result.current.position).toBe('bottom');
    act(() => result.current.cyclePosition());
    expect(result.current.position).toBe('top');
  });

  it('persists the new position to localStorage', () => {
    const { result } = renderHook(() => useChallengeOverlayPosition());
    act(() => result.current.cyclePosition());
    expect(window.localStorage.getItem(CHALLENGE_OVERLAY_POSITION_KEY)).toBe('middle');
  });

  it('rejects an invalid stored value and falls back to "top"', () => {
    window.localStorage.setItem(CHALLENGE_OVERLAY_POSITION_KEY, 'sideways');
    const { result } = renderHook(() => useChallengeOverlayPosition());
    expect(result.current.position).toBe('top');
  });
});
