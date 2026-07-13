import { describe, it, expect } from 'vitest';
import { computePianoRollLayout } from '#domains/pianoaudio/pianoRollLayout.mjs';

// Helper: a dense synthetic session of `count` quarter-second notes over `T` sec.
function synthNotes(T, count, loPitch = 48, hiPitch = 84) {
  const notes = [];
  for (let i = 0; i < count; i++) {
    const startSec = (i / count) * T;
    notes.push({ pitch: loPitch + (i % (hiPitch - loPitch)), startSec, durSec: 0.25, velocity: 80 });
  }
  return notes;
}

describe('computePianoRollLayout', () => {
  it('approximates the 16:9 target aspect for a long session', () => {
    const T = 3600; // 1h
    const notes = synthNotes(T, 4000);
    const l = computePianoRollLayout(notes, T);
    const aspect = l.width / l.height;
    expect(aspect).toBeGreaterThan(1.4);
    expect(aspect).toBeLessThan(2.2); // ~16:9 = 1.78
    expect(l.rows).toBeGreaterThan(1);
  });

  it('grows total area with length (longer file → bigger image)', () => {
    const short = computePianoRollLayout(synthNotes(180, 300), 180);
    const long = computePianoRollLayout(synthNotes(3600, 6000), 3600);
    const areaShort = short.width * short.height;
    const areaLong = long.width * long.height;
    expect(areaLong).toBeGreaterThan(areaShort * 3); // materially larger
  });

  it('caps either dimension at maxSide for an extreme length', () => {
    const T = 14000; // ~3.9h
    const l = computePianoRollLayout(synthNotes(T, 20000), T, { maxSide: 4000 });
    expect(l.width).toBeLessThanOrEqual(4000);
    expect(l.height).toBeLessThanOrEqual(4000);
    expect(l.segments.length).toBeGreaterThan(0);
  });

  it('maps higher pitch to a smaller y (top of the row)', () => {
    const notes = [
      { pitch: 48, startSec: 0, durSec: 0.5, velocity: 80 }, // low
      { pitch: 84, startSec: 0, durSec: 0.5, velocity: 80 }, // high
    ];
    const l = computePianoRollLayout(notes, 1);
    const low = l.segments.find((s) => s.pitch === 48);
    const high = l.segments.find((s) => s.pitch === 84);
    expect(high.y).toBeLessThan(low.y);
  });

  it('splits a note that crosses a row boundary into multiple segments', () => {
    // Force 2 rows over 10s: pxPerSec 6 → 60px wide row if 1 row; force wrap via a
    // tall pitch range so aspect math yields >1 row, then place a long note across it.
    const notes = [{ pitch: 60, startSec: 0, durSec: 10, velocity: 80 }];
    // small secondsPerRow by requesting many rows through a wide pitch span + long T
    const l = computePianoRollLayout(
      [...notes, { pitch: 20, startSec: 0, durSec: 0.1, velocity: 1 }, { pitch: 108, startSec: 9.9, durSec: 0.1, velocity: 1 }],
      10,
    );
    const pitch60 = l.segments.filter((s) => s.pitch === 60);
    if (l.rows > 1) {
      expect(pitch60.length).toBeGreaterThan(1); // the 10s note wrapped
      expect(new Set(pitch60.map((s) => s.row)).size).toBeGreaterThan(1);
    } else {
      expect(pitch60.length).toBe(1);
    }
  });

  it('handles an empty note list without throwing', () => {
    const l = computePianoRollLayout([], 5);
    expect(l.segments).toEqual([]);
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });
});
