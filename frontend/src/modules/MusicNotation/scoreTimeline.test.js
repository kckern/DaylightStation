import { describe, it, expect } from 'vitest';
import { buildTempoMap, msAtQuarter, buildStepTimeline, buildNoteTimeline } from './scoreTimeline.js';

describe('buildTempoMap', () => {
  it('falls back to a single segment at the fallback bpm', () => {
    expect(buildTempoMap([], 90)).toEqual([{ onsetQuarter: 0, bpm: 90 }]);
    expect(buildTempoMap(null, 90)).toEqual([{ onsetQuarter: 0, bpm: 90 }]);
  });
  it('sorts, dedupes same-onset (last wins) and same-bpm runs, anchors at 0', () => {
    const map = buildTempoMap([
      { onsetQuarter: 16, bpm: 120 },
      { onsetQuarter: 0, bpm: 72 },
      { onsetQuarter: 16, bpm: 126 }, // same onset — later entry wins
      { onsetQuarter: 24, bpm: 126 }, // no change — dropped
    ], 90);
    expect(map).toEqual([{ onsetQuarter: 0, bpm: 72 }, { onsetQuarter: 16, bpm: 126 }]);
  });
  it('extends the first tempo back to quarter 0 when the score starts late', () => {
    expect(buildTempoMap([{ onsetQuarter: 4, bpm: 100 }], 90)[0]).toEqual({ onsetQuarter: 0, bpm: 100 });
  });
  it('ignores junk entries', () => {
    expect(buildTempoMap([{ onsetQuarter: 0, bpm: 0 }, { onsetQuarter: NaN, bpm: 100 }], 90))
      .toEqual([{ onsetQuarter: 0, bpm: 90 }]);
  });
});

describe('msAtQuarter', () => {
  const map = [{ onsetQuarter: 0, bpm: 60 }, { onsetQuarter: 4, bpm: 120 }]; // 1000ms/q then 500ms/q
  it('converts within the first segment', () => {
    expect(msAtQuarter(map, 0)).toBe(0);
    expect(msAtQuarter(map, 2)).toBe(2000);
  });
  it('accumulates across tempo changes', () => {
    expect(msAtQuarter(map, 4)).toBe(4000);
    expect(msAtQuarter(map, 6)).toBe(5000); // 4×1000 + 2×500
  });
});

describe('buildStepTimeline', () => {
  it('emits one {t, index} per event under the map', () => {
    const map = [{ onsetQuarter: 0, bpm: 120 }]; // 500ms/q
    const tl = buildStepTimeline([{ onsetQuarter: 0 }, { onsetQuarter: 1 }, { onsetQuarter: 2.5 }], map);
    expect(tl).toEqual([{ t: 0, index: 0 }, { t: 500, index: 1 }, { t: 1250, index: 2 }]);
  });
});

describe('buildNoteTimeline', () => {
  const map = [{ onsetQuarter: 0, bpm: 60 }]; // 1000ms/q
  const notes = [
    { midi: 60, staff: 1, onsetQuarter: 0, durationQuarters: 1 },
    { midi: 48, staff: 2, onsetQuarter: 0, durationQuarters: 2 },
    { midi: 60, staff: 1, onsetQuarter: 1, durationQuarters: 1 }, // repeated pitch
  ];
  it('emits on/off pairs in time order, off slightly early to re-articulate repeats', () => {
    const tl = buildNoteTimeline(notes, map);
    expect(tl.map((e) => [e.type, e.note, e.t])).toEqual([
      ['note_on', 60, 0], ['note_on', 48, 0],
      ['note_off', 60, 990],      // 10ms gap before the next C
      ['note_on', 60, 1000],
      ['note_off', 48, 1990], ['note_off', 60, 1990],
    ]);
  });
  it('filters through isAudible (part mute)', () => {
    const tl = buildNoteTimeline(notes, map, { isAudible: (n) => n.staff === 2 });
    expect(tl.every((e) => e.note === 48)).toBe(true);
  });
});
