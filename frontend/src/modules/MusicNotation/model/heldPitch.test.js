import { describe, expect, it } from 'vitest';
import { attemptUnderWay, classifyHeldPitch, partitionHeldPitches } from './heldPitch.js';

/**
 * The one rule every staff that draws live feedback grades on. It exists because
 * a legato scale — which is how a scale is played — keeps the previous key down
 * while the cursor moves on, and both renderers used to read that as a mistake.
 *
 * `attemptUnderWay` is the half that had only ever been fixed in
 * `SvgSequenceStaff`: the abc stage kept arming off `activeNotes.size` ("is any
 * key down anywhere"), which is true the instant the cursor advances, so the
 * note the child had not reached yet was painted red before they touched it.
 */
const at = (timestamp) => ({ timestamp });
const held = (entries) => new Map(entries);

describe('classifyHeldPitch', () => {
  it('a target of this entry is a target, whenever it went down', () => {
    expect(classifyHeldPitch(60, { pressedAt: 1, cursorArrivedAt: 100, cursorTargets: new Set([60]) })).toBe('target');
  });
  it('a key pressed after the cursor arrived, and not asked for, is a ghost', () => {
    expect(classifyHeldPitch(61, { pressedAt: 150, cursorArrivedAt: 100, cursorTargets: new Set([60]) })).toBe('ghost');
  });
  it('a key already down when the cursor arrived is a sustain — the note before', () => {
    expect(classifyHeldPitch(59, { pressedAt: 50, cursorArrivedAt: 100, cursorTargets: new Set([60]) })).toBe('sustain');
  });
  it('a tie is a sustain: no accusation on a rounding error', () => {
    expect(classifyHeldPitch(59, { pressedAt: 100, cursorArrivedAt: 100, cursorTargets: new Set([60]) })).toBe('sustain');
  });
});

describe('attemptUnderWay', () => {
  const targets = new Set([62]);

  it('nothing held is no attempt', () => {
    expect(attemptUnderWay(null, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(false);
    expect(attemptUnderWay(held([]), { cursorArrivedAt: 100, cursorTargets: targets })).toBe(false);
  });

  it('THE LEGATO CASE: a finger left on the previous note is not an attempt at this one', () => {
    // C is still down from the entry the engine already graded correct; the
    // cursor has moved to D and nothing has been played at it yet.
    const activeNotes = held([[60, at(50)]]);
    expect(attemptUnderWay(activeNotes, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(false);
  });

  it('the right key, played here, is an attempt', () => {
    const activeNotes = held([[60, at(50)], [62, at(140)]]);
    expect(attemptUnderWay(activeNotes, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(true);
  });

  it('a wrong key played here is an attempt — that is what gets shown', () => {
    const activeNotes = held([[60, at(50)], [65, at(140)]]);
    expect(attemptUnderWay(activeNotes, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(true);
  });

  it('a target held over from before still counts: the child is on the note', () => {
    const activeNotes = held([[62, at(10)]]);
    expect(attemptUnderWay(activeNotes, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(true);
  });

  it('an unstamped held set behaves as it always did — every caller that passes a bare velocity map', () => {
    const activeNotes = held([[65, { velocity: 90 }]]);
    expect(attemptUnderWay(activeNotes, { cursorArrivedAt: 100, cursorTargets: targets })).toBe(true);
  });
});

describe('partitionHeldPitches', () => {
  it('splits a legato chord into what to draw and what to stay quiet about', () => {
    const activeNotes = held([[60, at(50)], [62, at(140)], [64, at(150)]]);
    const { ghosts, sustains } = partitionHeldPitches(activeNotes, {
      cursorArrivedAt: 100, cursorTargets: new Set([62]),
    });
    expect(ghosts.map((g) => g.midi)).toEqual([64]);
    expect(sustains.map((s) => s.midi)).toEqual([60]);
  });
});
