import { describe, it, expect } from 'vitest';
import { detectKey, KEY_SIGNATURES } from "./keySignature.js";

describe('KEY_SIGNATURES', () => {
  it('every key has a 7-note scale', () => {
    for (const data of Object.values(KEY_SIGNATURES)) {
      expect(data.scale).toHaveLength(7);
    }
  });
});

describe('detectKey', () => {
  it('returns current key when too few notes (<5)', () => {
    expect(detectKey([0, 4, 7], 'F')).toBe('F');
  });

  it('returns current key when too few unique pitches (<3)', () => {
    expect(detectKey([0, 0, 0, 0, 0, 0], 'F')).toBe('F');
  });

  it('resolves a G-major run to G from C (tonic/dominant + F#)', () => {
    // G B D … A F# E G — emphasizes G tonic, D dominant, F# leading tone.
    const pcs = [7, 11, 2, 7, 11, 2, 9, 6, 4, 7];
    expect(detectKey(pcs, 'C')).toBe('G');
  });

  it('resolves an F-major run to F from C (tonic/dominant + Bb)', () => {
    // F A C … Bb C F — emphasizes F tonic, C dominant, includes Bb.
    const pcs = [5, 9, 0, 5, 9, 0, 10, 5, 7, 5];
    expect(detectKey(pcs, 'C')).toBe('F');
  });

  it('resolves a D-major arpeggio to D from C', () => {
    // D F# A … E C# D — D tonic, A dominant, C# leading tone.
    const pcs = [2, 6, 9, 2, 6, 9, 4, 1, 11, 2];
    expect(detectKey(pcs, 'D')).toBe('D');
    expect(detectKey(pcs, 'C')).toBe('D');
  });

  it('holds the settled key when a rival only marginally edges it (hysteresis)', () => {
    // C-major triad heavy with a light G lean: G scores only ~1.8% above C,
    // well inside the 5% relative hysteresis margin, so C must hold.
    const pcs = [0, 4, 7, 0, 4, 7, 2, 11, 9, 6, 7];
    expect(detectKey(pcs, 'C')).toBe('C');
  });

  it('adopts the detected key when currentKey is not a known major key', () => {
    // A stale/minor/enharmonic currentKey ('Cb') has no profile score, so the
    // margin must be skipped rather than making the guard always-true.
    const gMajor = [7, 11, 2, 7, 11, 2, 9, 6, 4, 7];
    expect(detectKey(gMajor, 'Cb')).toBe('G');
  });

  it('returns a sane key for clear C-major material with no currentKey arg', () => {
    // Guards the Producer.jsx one-shot: detectKey(notes.map(n => n.midi % 12)).
    const pcs = [0, 2, 4, 5, 7, 9, 11, 0, 4, 7];
    expect(detectKey(pcs)).toBe('C');
  });
});

describe('detectKey stability on chromatic playing', () => {
  // Pitch classes of the newly pressed keys in ~7s of a child improvising around the
  // black keys (a real studio take, distilled). Replayed through the same rolling
  // 30-note window useDetectedKey keeps. At the old 5% margin / 5-note floor this
  // stretch re-detected the key eight times, bouncing D♭ <-> F♯ twice.
  const IMPROV = [9,5,1,0,6,1,6,9,6,6,0,1,1,11,1,1,6,6,9,9,3,11,3,9,6,6,9,4,4,4,11,8,11,4,8,8,8,4,11,11,4,9,8,8,1,0,6,1,6,9,6,6,0,1,1,9,5,5,1,0,6,1,6,9,6,6,0,1,1,11,5,5,6,11,9,3,6,11,6,9,11,6,3,4,9,9,11,11,4,4,8,8,8,4,11,11,4,9,8,8,1,0,6,1,9,6,6,6,0,1,1,9,5,5,1,0,6,1,6,9,6,6,0,1,1];
  const replay = (start) => {
    let key = start; const buf = []; const changes = [];
    IMPROV.forEach((pc) => {
      buf.push(pc); if (buf.length > 30) buf.shift();
      const next = detectKey(buf, key);
      if (next !== key) { changes.push([key, next]); key = next; }
    });
    return changes;
  };

  it('never re-enters D♭ once it has moved to F♯ (the render-11 flap)', () => {
    const entered = replay('Db').map(([, to]) => to);
    expect(entered).not.toContain('Db');
  });

  it('holds each detected key for at least eight notes before the next change', () => {
    // Stability stated as a dwell time. This take legitimately revisits a key (E <-> F#
    // sit a fifth-circle step apart and the passage genuinely moves between them), so
    // "never re-enter" would be false; what the hysteresis + 8-note floor guarantee is
    // that no change follows another within eight notes. Measured dwells here: 29, 27,
    // 29, 17, 10 notes. The 5% / 5-note version flapped D-flat <-> F# within a few notes.
    const IMPROV_CHANGES = [];
    let key = 'Db'; const buf = [];
    IMPROV.forEach((pc, i) => {
      buf.push(pc); if (buf.length > 30) buf.shift();
      const next = detectKey(buf, key);
      if (next !== key) { IMPROV_CHANGES.push(i); key = next; }
    });
    expect(IMPROV_CHANGES.length).toBeGreaterThan(1);
    for (let i = 1; i < IMPROV_CHANGES.length; i += 1) {
      expect(IMPROV_CHANGES[i] - IMPROV_CHANGES[i - 1]).toBeGreaterThanOrEqual(8);
    }
  });

  it('does not let a rival win on fewer than eight notes', () => {
    // Nine D-major tones would flip C, but only the first seven are in hand.
    const d = [2, 6, 9, 2, 6, 9, 4, 1, 11];
    expect(detectKey(d.slice(0, 7), 'C')).toBe('C');
    expect(detectKey(d, 'C')).toBe('D');
  });
});
