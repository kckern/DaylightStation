import { describe, expect, it } from 'vitest';
import { keysInstance } from './gateMaterial.js';
import { staffFitsAsk } from '../Exercises/runPresentation.js';
import { MAX_ASK_SPAN } from '../../../ask/stagecraft.js';

/**
 * A LIT-KEY ASK MUST ALWAYS BE DRAWABLE ON A STAFF.
 *
 * The rungs a pre-reader climbs (`keys-2`, `keys-3`, `sightread-1`) all author
 * a staff beside the keyboard — it is the half of the mapping that teaches
 * reading. But the spread between notes is applied between every ADJACENT pair,
 * so three notes a fifth apart spanned fourteen semitones, `staffFitsAsk`
 * refused to draw anything that wide, and seven of every twenty-one picks
 * arrived as a bare keyboard filling the screen. A child got notation on some
 * launches and not others with nothing in the ask to explain the difference.
 *
 * The pick index is the only source of variation and is persisted across gates,
 * so "some picks" means "some launches, unpredictably" — which is why this
 * sweeps the index rather than testing one shape.
 */
const SPECS = [
  ['two keys together', { kind: 'keys', notes: 2, arrangement: 'together' }],
  ['three keys in order', { kind: 'keys', notes: 3, arrangement: 'sequence' }],
  ['the sight-reading deck', { kind: 'keys', notes: 3, arrangement: 'sequence', reps: 3 }],
];
const midisOf = (instance) => [...new Set(instance.events.flatMap((e) => e.notes.map((n) => n.midi)))];

describe('every lit-key ask the gate can deal', () => {
  it.each(SPECS)('%s keeps its staff at every pick index', (_label, spec) => {
    const bare = [];
    for (let pick = 0; pick < 42; pick += 1) {
      if (!staffFitsAsk(keysInstance(spec, pick).events)) bare.push(pick);
    }
    expect(bare, `picks ${bare.join(', ')} draw a keyboard with no staff`).toEqual([]);
  });

  it.each(SPECS)('%s stays inside the window one staff can draw', (_label, spec) => {
    for (let pick = 0; pick < 42; pick += 1) {
      const midis = midisOf(keysInstance(spec, pick));
      expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(MAX_ASK_SPAN);
    }
  });

  it('still varies the shape rather than settling on one safe interval', () => {
    // Narrowing the choice must not collapse it: a rung that always deals the
    // same triad is a rung a child memorises instead of reads.
    const shapes = new Set();
    for (let pick = 0; pick < 42; pick += 1) shapes.add(midisOf(keysInstance(SPECS[1][1], pick)).join(','));
    expect(shapes.size).toBeGreaterThanOrEqual(10);
  });

  it('leaves the single-key floor exactly as it was', () => {
    // `keys-1` is the unfailable floor. It has no spread to choose.
    for (let pick = 0; pick < 14; pick += 1) {
      const midis = midisOf(keysInstance({ kind: 'keys', notes: 1 }, pick));
      expect(midis).toHaveLength(1);
    }
  });
});
