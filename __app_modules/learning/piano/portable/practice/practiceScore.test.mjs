import { describe, it, expect } from 'vitest';
import {
  tallyPractice, createPracticeMeter, classifyBurst, burstState, PRACTICE_DEFAULTS, PRESCHOOL_PRACTICE,
} from './practiceScore.mjs';

const ev = (t, note, velocity = 64) => ({ t, note, velocity });
/** A humanised melodic line: stepwise, uneven timing and velocity. */
function melody(n, { start = 0, root = 60, gap = 400 } = {}) {
  const scale = [0, 2, 4, 5, 7, 5, 4, 2];
  const out = [];
  for (let i = 0; i < n; i++) out.push(ev(start + i * gap + ((i * 37) % 90), root + scale[i % scale.length], 55 + ((i * 13) % 30)));
  return out;
}

describe('tallyPractice', () => {
  it('empty input gives zeros', () => {
    const t = tallyPractice([]);
    expect(t.humanNotes).toBe(0);
    expect(t.practiceNotes).toBe(0);
    expect(t.retention).toBe(0);
    expect(Object.values(t.penalties).every((v) => v === 0)).toBe(true);
  });

  it('single notes and 3-note chords keep full weight', () => {
    const notes = melody(12);
    for (let i = 0; i < 4; i++) {
      const t = 6000 + i * 600;
      notes.push(ev(t, 60, 70), ev(t + 5, 64, 66), ev(t + 9, 67, 72));
    }
    const r = tallyPractice(notes);
    expect(r.humanNotes).toBe(24);
    expect(r.practiceNotes).toBeCloseTo(24, 5);
  });

  it('a 7-key fist weighs 0', () => {
    const notes = [];
    for (let k = 0; k < 7; k++) notes.push(ev(k * 3, 50 + k, 90));
    const r = tallyPractice(notes);
    expect(r.practiceNotes).toBe(0);
    expect(r.penalties.fist).toBe(7);
  });

  it('two 2-note hands more than an octave apart keep full weight', () => {
    const notes = [ev(0, 48, 60), ev(4, 52, 64), ev(8, 67, 70), ev(12, 72, 66)];
    expect(tallyPractice(notes).practiceNotes).toBe(4);
  });

  it('twelve presses of one key are discounted below 0.3', () => {
    const notes = [];
    for (let i = 0; i < 12; i++) notes.push(ev(i * 220, 60, 60 + (i % 5) * 6));
    const r = tallyPractice(notes);
    expect(r.practiceNotes).toBeLessThan(0.3 * r.humanNotes);
    expect(r.penalties.hammer).toBe(12);
  });

  it('three repeats of one key keep full weight', () => {
    const notes = [ev(0, 60, 60), ev(500, 60, 70), ev(1000, 60, 66), ev(1500, 62, 64)];
    expect(tallyPractice(notes).practiceNotes).toBe(4);
  });

  it('a glissando is discounted', () => {
    const notes = [];
    for (let i = 0; i < 36; i++) notes.push(ev(i * 33, 48 + i, 70 + (i % 7)));
    const r = tallyPractice(notes);
    expect(r.retention).toBeLessThan(0.3);
  });

  it('flat velocity across 20 notes is discounted; humanised velocity is not', () => {
    const flat = melody(20).map((e) => ({ ...e, velocity: 80 }));
    const human = melody(20);
    // Mild on purpose: a piano set to fixed touch is still a child playing.
    expect(tallyPractice(flat).retention).toBeLessThanOrEqual(0.5);
    expect(tallyPractice(flat).penalties.flatVelocity).toBe(20);
    expect(tallyPractice(human).retention).toBe(1);
  });
});

describe('createPracticeMeter', () => {
  it('snapshot equals the tally over all added events', () => {
    const notes = [
      ...melody(20),
      ...Array.from({ length: 12 }, (_, i) => ev(20000 + i * 200, 60, 70 + (i % 4))),
      ...melody(10, { start: 30000 }),
    ];
    const m = createPracticeMeter();
    for (const e of notes) m.add(e);
    const a = m.snapshot();
    const b = tallyPractice(notes);
    expect(a.humanNotes).toBe(b.humanNotes);
    expect(a.practiceNotes).toBeCloseTo(b.practiceNotes, 9);
    expect(a.penalties).toEqual(b.penalties);
  });

  it('since(t) returns events at or after t; reset clears', () => {
    const m = createPracticeMeter();
    for (const e of melody(10)) m.add(e);
    expect(m.since(2000).every((e) => e.t >= 2000)).toBe(true);
    expect(m.since(2000).length).toBeGreaterThan(0);
    m.reset();
    expect(m.snapshot().humanNotes).toBe(0);
  });
});

describe('classifyBurst', () => {
  it('10 stepwise humanised notes → legit', () => {
    const r = classifyBurst(melody(10));
    expect(r.verdict).toBe('legit');
    expect(r.legitNotes).toBe(10);
  });

  it('10 presses of one key → spam', () => {
    const notes = Array.from({ length: 10 }, (_, i) => ev(i * 250, 60, 60 + (i % 6) * 5));
    expect(classifyBurst(notes).verdict).toBe('spam');
  });

  it('a repeated fist → spam', () => {
    const notes = [];
    for (let c = 0; c < 4; c++) for (let k = 0; k < 7; k++) notes.push(ev(c * 400 + k * 2, 50 + k, 90));
    expect(classifyBurst(notes).verdict).toBe('spam');
  });

  it('6 good notes → spam (too few)', () => {
    expect(classifyBurst(melody(6)).verdict).toBe('spam');
  });

  it('a mixed burst → ambiguous', () => {
    // 12 good notes, then 4 fists of 6 keys: retention (12/36) would be spam,
    // so use 16 good notes + one 6-key fist + one 5-note chord.
    const notes = melody(16);
    for (let k = 0; k < 6; k++) notes.push(ev(9000 + k * 2, 40 + k, 80));
    for (let k = 0; k < 5; k++) notes.push(ev(9500 + k * 2, 60 + k, 80));
    const r = classifyBurst(notes);
    expect(r.verdict).toBe('ambiguous');
    expect(r.retention).toBeGreaterThan(PRACTICE_DEFAULTS.legitWeight * 0);
  });
});

describe('burstState', () => {
  it('caps at 200 notes, relative onsets, only the five stats', () => {
    const notes = melody(260, { start: 5000, gap: 300 }).map((e) => ({ ...e, durMs: 180 }));
    const r = classifyBurst(notes);
    const s = burstState(notes, r.stats);
    expect(s.notes).toHaveLength(200);
    expect(s.notes[0].onsetMs).toBe(0);
    expect(Object.keys(s.notes[0]).sort()).toEqual(['durMs', 'onsetMs', 'pitch', 'velocity']);
    expect(s.notes[0].durMs).toBe(180);
    expect(Object.keys(s).sort()).toEqual(['notes', 'stats']);
    expect(Object.keys(s.stats).sort()).toEqual(['distinctPitches', 'medianIoiMs', 'notes', 'pitchSpan', 'velocitySpread']);
  });
});

describe('preschool (lenient) weighting', () => {
  it('a fist and a hammered key count in full', () => {
    const fist = Array.from({ length: 7 }, (_, k) => ev(k * 3, 50 + k, 90));
    const hammer = Array.from({ length: 12 }, (_, i) => ev(5000 + i * 220, 60, 60));
    const r = tallyPractice([...fist, ...hammer], PRESCHOOL_PRACTICE);
    expect(r.practiceNotes).toBe(19);
    expect(r.retention).toBe(1);
  });
  it('bursts: 8 presses of one key → legit; 6 notes → spam; a fist mash → legit', () => {
    const hammer = Array.from({ length: 8 }, (_, i) => ev(i * 250, 60, 70));
    expect(classifyBurst(hammer, PRESCHOOL_PRACTICE).verdict).toBe('legit');
    expect(classifyBurst(melody(6), PRESCHOOL_PRACTICE).verdict).toBe('spam');
    const fists = [];
    for (let c = 0; c < 2; c++) for (let k = 0; k < 7; k++) fists.push(ev(c * 400 + k * 2, 50 + k, 90));
    expect(classifyBurst(fists, PRESCHOOL_PRACTICE).verdict).toBe('legit');
  });
});
