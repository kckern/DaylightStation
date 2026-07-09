import { describe, it, expect } from 'vitest';
import { remapProgress } from './migrateProgress.mjs';

describe('remapProgress', () => {
  it('rewrites mapped plex keys, keeps unmapped', () => {
    const progress = {
      'plex:676057': { percent: 100, lastPlayed: '2026-06-28T18:45:30Z' },
      'plex:111111': { percent: 40, lastPlayed: '2026-06-01T00:00:00Z' },  // unmapped (other show)
    };
    const map = { '676057': '999001' };
    const { out, moved, kept } = remapProgress(progress, map);
    expect(out['plex:999001']).toEqual({ percent: 100, lastPlayed: '2026-06-28T18:45:30Z' });
    expect(out['plex:676057']).toBeUndefined();
    expect(out['plex:111111']).toEqual({ percent: 40, lastPlayed: '2026-06-01T00:00:00Z' });
    expect(moved).toBe(1);
    expect(kept).toBe(1);
  });
  it('on collision keeps the newer lastPlayed', () => {
    const progress = {
      'plex:1': { percent: 50, lastPlayed: '2026-01-01T00:00:00Z' },
      'plex:2': { percent: 90, lastPlayed: '2026-05-01T00:00:00Z' },
    };
    const map = { '1': '999', '2': '999' };
    const { out } = remapProgress(progress, map);
    expect(out['plex:999'].percent).toBe(90);  // newer wins
  });
});
