import { describe, expect, it } from 'vitest';
import { scaleScoreTempoMap, scaledScoreBpm } from './scoreTempo.js';

describe('score tempo scaling', () => {
  it('scales every MusicXML tempo change without mutating the authored map', () => {
    const authored = [{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 80 }];
    expect(scaleScoreTempoMap(authored, 60)).toEqual([
      { onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 8, bpm: 48 },
    ]);
    expect(authored[0].bpm).toBe(100);
  });

  it('uses the same percentage for a fallback tempo', () => {
    expect(scaledScoreBpm(90, 60)).toBe(54);
    expect(scaledScoreBpm(90, 100)).toBe(90);
  });
});
