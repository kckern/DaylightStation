import React from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { VolumeProvider } from './VolumeProvider.jsx';
import { useGameVolume } from './useGameVolume.js';
import { usePersistentVolume } from './usePersistentVolume.js';

const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
    data,
  };
};

const wrap = (storage) => ({ children }) => <VolumeProvider storage={storage}>{children}</VolumeProvider>;

describe('useGameVolume', () => {
  it('plays an unset game at the audible default even when the video level is 10%', () => {
    const storage = memoryStorage({ 'volume:fitness:fitness:global:video': JSON.stringify({ level: 0.1, muted: false }) });
    const { result } = renderHook(() => useGameVolume('skyline-glider'), { wrapper: wrap(storage) });
    expect(result.current.level).toBe(60);
    expect(result.current.output).toBeGreaterThan(0.15);
  });

  it('setLevel persists the output gain on the game track only (video level untouched)', () => {
    const storage = memoryStorage({ 'volume:fitness:fitness:global:video': JSON.stringify({ level: 0.1, muted: false }) });
    const { result } = renderHook(() => ({
      game: useGameVolume('cycle-game'),
      video: usePersistentVolume({ grandparentId: 'fitness', parentId: 'global', trackId: 'video' }),
    }), { wrapper: wrap(storage) });
    act(() => result.current.game.setLevel(80));
    expect(result.current.game.level).toBe(80);
    expect(result.current.game.output).toBeCloseTo(0.398, 2);
    expect(result.current.video.volume).toBe(0.1);
    const saved = JSON.parse(storage.data.get('volume:fitness:fitness-game-cycle-game:global:game'));
    expect(saved.level).toBeCloseTo(0.398, 2);
  });

  it('toggleMute on an unset track keeps the default level, then unmutes to it', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useGameVolume('skyline-glider'), { wrapper: wrap(storage) });
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);
    expect(result.current.output).toBe(0);
    expect(result.current.level).toBe(60);
    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(false);
    expect(result.current.level).toBe(60);
  });

  it('choosing a level unmutes; choosing 0 mutes', () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useGameVolume('skyline-glider'), { wrapper: wrap(storage) });
    act(() => result.current.toggleMute());
    act(() => result.current.setLevel(30));
    expect(result.current.muted).toBe(false);
    expect(result.current.level).toBe(30);
    act(() => result.current.setLevel(0));
    expect(result.current.muted).toBe(true);
    expect(result.current.output).toBe(0);
  });
});
