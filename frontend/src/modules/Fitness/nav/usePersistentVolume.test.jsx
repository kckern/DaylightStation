import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Capture what the store's applyToPlayer is asked to apply.
let applied = [];
const store = {
  getVolume: () => ({ level: 0.8, muted: false, source: 'global' }),
  setVolume: (_ids, patch) => ({ level: patch.level ?? 0.8, muted: patch.muted ?? false, source: 'exact' }),
  applyToPlayer: (_playerRef, state) => { applied.push(state); },
  version: 0,
};

vi.mock('./VolumeProvider.jsx', () => ({
  useVolumeStore: () => store,
}));

import { usePersistentVolume } from './usePersistentVolume.js';

describe('usePersistentVolume — duck multiplier', () => {
  let playerRef;
  beforeEach(() => {
    applied = [];
    playerRef = { current: { getMediaElement: () => ({ volume: 1 }) } };
  });

  const render = () =>
    renderHook(() => usePersistentVolume({ grandparentId: 'fitness', parentId: 'global', trackId: 'video', playerRef }));

  it('defaults the duck multiplier to 1 (no change to applied level)', () => {
    const { result } = render();
    act(() => result.current.applyToPlayer());
    expect(applied.at(-1).level).toBeCloseTo(0.8, 5);
  });

  it('folds the duck multiplier into applied level and never raises it', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    expect(applied.at(-1).level).toBeCloseTo(0.08, 5); // 0.8 * 0.1, applied immediately
    act(() => result.current.applyToPlayer());
    expect(applied.at(-1).level).toBeCloseTo(0.08, 5); // re-apply still ducked
  });

  it('keeps the duck applied across a setVolume (user change) mid-duck', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    act(() => result.current.setVolume(0.5));
    expect(applied.at(-1).level).toBeCloseTo(0.05, 5); // 0.5 * 0.1
  });

  it('restores full level when the duck is released', () => {
    const { result } = render();
    act(() => result.current.setDuck(0.1));
    act(() => result.current.setDuck(1));
    expect(applied.at(-1).level).toBeCloseTo(0.8, 5);
  });

  it('clamps the multiplier to [0,1] (cannot amplify)', () => {
    const { result } = render();
    act(() => result.current.setDuck(5));
    expect(applied.at(-1).level).toBeLessThanOrEqual(0.8);
  });
});
