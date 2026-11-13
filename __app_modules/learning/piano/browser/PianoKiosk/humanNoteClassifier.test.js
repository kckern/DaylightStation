import { describe, it, expect } from 'vitest';
import { createHumanNoteClassifier } from './humanNoteClassifier.js';
import rhythmLoopSitting from './__fixtures__/humanNotes/rhythm-loop-sitting.json';
import genuinePlay from './__fixtures__/humanNotes/genuine-play.json';
import loopWithChild from './__fixtures__/humanNotes/loop-with-child.json';
import clockwork from './__fixtures__/humanNotes/clockwork-playback.json';

const T0 = 1_762_000_000_000;

/** Feeds a fixture's notes (channel-less, like the piano-bridge) and returns each verdict. */
function run(notes, opts) {
  const c = createHumanNoteClassifier(opts);
  const out = notes.map(([ms, note, velocity]) => ({ ms, note, ...c.classify({ note, velocity, time: T0 + ms }) }));
  return { c, out };
}

/** Longest stretch with no human-classified note, from `fromMs` to the last note. */
function longestHumanGapMs(out, fromMs = 0) {
  let last = fromMs;
  let worst = 0;
  for (const v of out) {
    if (v.ms < fromMs || !v.human) continue;
    worst = Math.max(worst, v.ms - last);
    last = v.ms;
  }
  return Math.max(worst, out[out.length - 1].ms - last);
}

describe('humanNoteClassifier — real captures', () => {
  it('drum-loop sitting (nobody at the piano): the 90 s presence prompt would fire', () => {
    const { out, c } = run(rhythmLoopSitting.notes);
    expect(c.loopActive).toBe(true);
    // Only the loop's arm-up (first ~20 s, plus a 3 s re-arm when the rhythm is
    // restarted) passes as human; after that nothing resets the idle clock.
    expect(longestHumanGapMs(out)).toBeGreaterThanOrEqual(90_000);
    const humanAfterArm = out.filter((v) => v.ms > 50_000 && v.human).length;
    expect(humanAfterArm).toBe(0);
    expect([...c.loopPitches].sort((a, b) => a - b)).toEqual([36, 37, 42, 62, 63, 64, 80, 81, 82]);
  });

  it('genuine play: every note counts', () => {
    const { out } = run(genuinePlay.notes);
    expect(out.length).toBeGreaterThan(200);
    expect(out.filter((v) => !v.human)).toEqual([]);
  });

  it('child playing over the rhythm loop: the child counts, the drums do not', () => {
    const c = createHumanNoteClassifier();
    // The child plays alone first; the rhythm starts ~45 s in. Skip the loop's
    // 20 s arm-up after its first beat.
    const armedFrom = loopWithChild.notes.find((n) => n[3] === 0)[0] + 25_000;
    let childKept = 0; let child = 0; let drumsCaught = 0; let drums = 0;
    for (const [ms, note, velocity, isHuman] of loopWithChild.notes) {
      const v = c.classify({ note, velocity, time: T0 + ms });
      if (ms < armedFrom) continue;
      if (isHuman) { child++; if (v.human) childKept++; } else { drums++; if (!v.human) drumsCaught++; }
    }
    expect(child).toBeGreaterThan(150);
    // The child's notes ON the loop's own pitches (congas 62–64, a melody 67 played
    // as often as a drum) are lost while it runs; everything else counts.
    expect(childKept / child).toBeGreaterThan(0.8);
    expect(drumsCaught / drums).toBeGreaterThan(0.99);
  });

  it('clockwork playback echoed by the piano (248 ms grid, flat velocity) is machine', () => {
    const { out } = run(clockwork.notes);
    const tail = out.slice(26); // needs 12 onsets of evidence first (octave pairs = one onset)
    expect(tail.length).toBeGreaterThan(5);
    expect(tail.every((v) => !v.human && v.reason === 'machine-regular')).toBe(true);
  });
});

describe('humanNoteClassifier — rules', () => {
  it('a single prompt answer counts', () => {
    const c = createHumanNoteClassifier();
    expect(c.classify({ note: 60, velocity: 70, time: T0 })).toEqual({ human: true, reason: 'human', transition: null });
  });

  it('a prompt answer on a non-loop key counts while the loop runs', () => {
    const c = createHumanNoteClassifier();
    for (const [ms, note, velocity] of rhythmLoopSitting.notes) c.classify({ note, velocity, time: T0 + ms });
    expect(c.loopActive).toBe(true);
    const last = rhythmLoopSitting.notes[rhythmLoopSitting.notes.length - 1][0];
    expect(c.classify({ note: 60, velocity: 55, time: T0 + last + 5 }).human).toBe(true);
    expect(c.classify({ note: 42, velocity: 90, time: T0 + last + 10 }).reason).toBe('rhythm-loop');
  });

  it('known channels: 10 is percussion, accompaniment channels are machine, keys are human', () => {
    const c = createHumanNoteClassifier();
    expect(c.classify({ note: 36, time: T0, channel: 9 }).reason).toBe('percussion-channel');
    expect(c.classify({ note: 60, time: T0 + 1, channel: 5 }).reason).toBe('accompaniment-channel');
    expect(c.classify({ note: 60, time: T0 + 2, channel: 12 }).reason).toBe('accompaniment-channel');
    expect(c.classify({ note: 60, time: T0 + 3, channel: 0 }).human).toBe(true);
  });

  it('a steady human repeated note (uneven timing and touch) stays human', () => {
    const c = createHumanNoteClassifier();
    const jitter = [0, 23, -17, 31, -9, 14, -28, 6, 19, -21, 11, -4, 27, -13, 8];
    const vel = [62, 70, 58, 66, 73, 61, 68, 55, 64, 71, 60, 67, 59, 69, 63];
    const v = jitter.map((j, i) => c.classify({ note: 60, velocity: vel[i], time: T0 + i * 500 + j }));
    expect(v.every((x) => x.human)).toBe(true);
  });

  it('reports loop transitions and the loop stops counting as machine once it stops', () => {
    const c = createHumanNoteClassifier();
    const seen = [];
    let last = 0;
    for (const [ms, note, velocity] of rhythmLoopSitting.notes) {
      const v = c.classify({ note, velocity, time: T0 + ms });
      if (v.transition) seen.push(v.transition);
      last = ms;
    }
    expect(seen[0]).toBe('loop-on');
    // 15 s of silence, then the child plays a hi-hat pitch: the loop is gone.
    const v = c.classify({ note: 42, velocity: 70, time: T0 + last + 15_000 });
    expect(v.transition).toBe('loop-off');
    expect(v.human).toBe(true);
  });
});
