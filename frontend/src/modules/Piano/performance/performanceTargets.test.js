import { describe, expect, it } from 'vitest';
import { buildTempoMap } from '../../MusicNotation/scoreTimeline.js';
import { buildPerformanceTargets } from './performanceTargets.js';

describe('buildPerformanceTargets', () => {
  it('groups chords but preserves repeated attacks and measure metadata', () => {
    const targets = buildPerformanceTargets([
      { midi: 60, onsetQuarter: 0, durationQuarters: 1, staff: 0, measureIndex: 0 },
      { midi: 64, onsetQuarter: 0, durationQuarters: 1, staff: 0, measureIndex: 0 },
      { midi: 60, onsetQuarter: 1, durationQuarters: 1, staff: 0, measureIndex: 0 },
    ], { tempoMap: buildTempoMap([], 120) });
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({ pitches: [60, 64], measureIndex: 0, targetTimeMs: 0 });
    expect(targets[1]).toMatchObject({ pitches: [60], measureIndex: 0, targetTimeMs: 500 });
  });

  it('applies tempo maps, scaling, filtering, lead-in, and tie suppression', () => {
    const targets = buildPerformanceTargets([
      { midi: 60, onsetQuarter: 0, durationQuarters: 1, staff: 0 },
      { midi: 62, onsetQuarter: 1, durationQuarters: 1, staff: 1 },
      { midi: 64, onsetQuarter: 2, durationQuarters: 1, staff: 0, tie: 'stop' },
    ], {
      tempoMap: buildTempoMap([{ onsetQuarter: 0, bpm: 120 }, { onsetQuarter: 1, bpm: 60 }]),
      timeScale: 2,
      leadInMs: 3000,
      isExpected: (note) => note.staff === 1,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].targetTimeMs).toBe(4000);
    expect(targets[0].durationMs).toBe(2000);
  });
});
