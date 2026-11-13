import { describe, expect, it } from 'vitest';
import {
  GAME_DEFAULT_LEVEL,
  gameVolumeIds,
  resolveGameVolume,
  storedVolumeFromLevel,
} from './gameVolumeModel.js';

describe('gameVolumeModel', () => {
  it('gives every game its own store track, away from the video level', () => {
    expect(gameVolumeIds('skyline-glider')).toEqual({ grandparentId: 'fitness-game-skyline-glider', parentId: 'global', trackId: 'game' });
    expect(gameVolumeIds('cycle-game').grandparentId).not.toBe('fitness');
  });

  it('an unset track plays at the audible game default, not the store global 0.6', () => {
    const resolved = resolveGameVolume({ volume: 0.6, muted: false, source: 'global' });
    expect(resolved.level).toBe(GAME_DEFAULT_LEVEL);
    expect(resolved.output).toBeCloseTo(0.158, 2); // level 60 on the house log curve
    expect(resolved.isDefault).toBe(true);
  });

  it('a stored value is the output gain itself (music-player convention): no double curve', () => {
    const stored = storedVolumeFromLevel(50);
    expect(stored).toBeCloseTo(0.1, 5);
    const resolved = resolveGameVolume({ volume: stored, muted: false, source: 'exact' });
    expect(resolved.level).toBe(50);
    expect(resolved.output).toBeCloseTo(0.1, 5);
  });

  it('level 10 stays quiet but is never the 1.6% of a linear level fed through the curve twice', () => {
    const resolved = resolveGameVolume({ volume: storedVolumeFromLevel(10), muted: false, source: 'exact' });
    expect(resolved.level).toBe(10);
    expect(resolved.output).toBeCloseTo(storedVolumeFromLevel(10), 6);
  });

  it('mute silences without losing the level; level 0 reads as muted', () => {
    const muted = resolveGameVolume({ volume: storedVolumeFromLevel(70), muted: true, source: 'exact' });
    expect(muted.output).toBe(0);
    expect(muted.level).toBe(70);
    expect(muted.muted).toBe(true);
    const zero = resolveGameVolume({ volume: 0, muted: false, source: 'exact' });
    expect(zero.output).toBe(0);
    expect(zero.muted).toBe(true);
  });

  it('a per-game default can be supplied', () => {
    expect(resolveGameVolume({ volume: 0.6, source: 'global' }, { defaultLevel: 40 }).level).toBe(40);
  });
});
