import { describe, expect, it } from 'vitest';
import { askTupleFor, deriveStage } from './askSchema.js';
import { keysInstance } from '../PianoKiosk/modes/Games/gateMaterial.js';

/**
 * The sight-reading flashcard rung, pinned as a whole.
 *
 * The pieces are tested apart from each other elsewhere; what this pins is the
 * shape a household actually authors in `piano.yml`, because that is the thing
 * that has to keep working. A preschooler is handed one note on a staff, finds
 * it, and is handed the same note twice more before the pitch changes — nine
 * cards, three pitches, no number at the end.
 */
const LEVEL = {
  id: 'sightread-1',
  tier: 1,
  presentation: { prompt: 'read', secondary: 'keyboard-strip', notationStyle: 'flashcard', timing: 'free', hints: 'none' },
};
const SPEC = { kind: 'keys', notes: 3, arrangement: 'sequence', reps: 3 };

describe('a sight-reading flashcard rung, as a household authors it', () => {
  it('is a valid ask, judged on completion — there is no bar to fall under', () => {
    const { tuple, errors } = askTupleFor(LEVEL, SPEC);
    expect(errors).toEqual([]);
    expect(tuple.judging).toBe('completion');
  });

  it('mounts the flashcard stage, not a line of notes read across', () => {
    const { tuple } = askTupleFor(LEVEL, SPEC);
    expect(deriveStage(tuple, keysInstance(SPEC, 0))).toBe('single-note');
  });

  it('deals nine cards: three pitches, three consecutive reps each', () => {
    const inst = keysInstance(SPEC, 0);
    const midis = inst.events.map((ev) => ev.notes[0].midi);
    expect(midis).toHaveLength(9);
    expect(new Set(midis).size).toBe(3);
    expect(midis.slice(0, 3).every((m) => m === midis[0])).toBe(true);
  });

  it('serves different pitches on consecutive gates, so it is not one card forever', () => {
    const first = keysInstance(SPEC, 0).events.map((ev) => ev.notes[0].midi);
    const second = keysInstance(SPEC, 1).events.map((ev) => ev.notes[0].midi);
    expect(second).not.toEqual(first);
  });
});
