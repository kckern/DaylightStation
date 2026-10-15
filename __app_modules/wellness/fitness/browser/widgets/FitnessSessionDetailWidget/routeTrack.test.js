import { describe, it, expect } from 'vitest';
import { positionAtElapsedMs } from './routeTrack.js';

const track = { stepSeconds: 5, t: [0, 5, 10, 20], points: [[47.5, -122.1], [47.501, -122.1], [47.502, -122.1], [47.502, -122.098]] };

describe('positionAtElapsedMs', () => {
  it('returns sampled points exactly and interpolates between them', () => {
    expect(positionAtElapsedMs(track, 5_000)).toEqual([47.501, -122.1]);
    const mid = positionAtElapsedMs(track, 15_000);
    expect(mid[0]).toBeCloseTo(47.502, 6);
    expect(mid[1]).toBeCloseTo(-122.099, 6);
  });

  it('clamps outside the track and rejects a malformed one', () => {
    expect(positionAtElapsedMs(track, -1)).toEqual([47.5, -122.1]);
    expect(positionAtElapsedMs(track, 999_000)).toEqual([47.502, -122.098]);
    expect(positionAtElapsedMs({ t: [0], points: [[1, 1]] }, 0)).toBeNull();
  });
});
