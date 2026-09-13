import { describe, expect, it } from 'vitest';
import { failureAdvice } from './failureCoaching.js';

/**
 * The attempt this module exists for, as the log recorded it: a cued C major
 * scale, eight notes, nothing matched, every criterion zero. Twice, then a
 * third at 6/8. The panel said "Try the exercise again" all three times.
 */
const NOTHING_LANDED = { criteria: { completeness: 0, cleanliness: 0, placement: 0 }, score: 0 };
const HALF_LANDED = { criteria: { completeness: 0.75, cleanliness: 0.667, placement: 0.778 }, score: 0.73 };

describe('what a failing attempt is told', () => {
  it('names the grid when a cued ask matched nothing at all', () => {
    expect(failureAdvice(NOTHING_LANDED, 'cued'))
      .toBe('None of the notes landed in time. Listen to the clicks first, and start on the next one.');
  });

  it('does not blame the beat on a FREE ask that matched nothing', () => {
    // There was no beat. A free ask with nothing matched is a child who did not
    // play the notes, and telling them to listen to clicks they never heard is
    // advice about a rule they were not playing under.
    expect(failureAdvice(NOTHING_LANDED, 'free'))
      .toBe('Some of the notes did not arrive. Go slower and get every one.');
  });

  it('picks the weakest criterion, not a list of all three', () => {
    expect(failureAdvice(HALF_LANDED, 'cued'))
      .toBe('Some of the notes did not arrive. Go slower and get every one.');
  });

  it('names the beat only once every note has actually arrived', () => {
    expect(failureAdvice({ criteria: { completeness: 1, cleanliness: 1, placement: 0.6 } }, 'cued'))
      .toBe('The right notes, just not on the beat. Stay with the clicks.');
  });

  it('names extra notes when everything else is in place', () => {
    expect(failureAdvice({ criteria: { completeness: 1, cleanliness: 0.5 } }, 'free'))
      .toBe('Some extra notes crept in. Lift each finger before the next one.');
  });

  it('reads a stall — real notes, then a stop — as what it is', () => {
    // A timeout finalizes with diagnostics and NO criteria at all.
    expect(failureAdvice({ status: 'timeout' }, 'free'))
      .toBe('That one stopped before the end. Play it all the way through.');
  });

  it('says nothing rather than guessing when every criterion is nearly there', () => {
    // A verdict-driven fail with no weak criterion has no honest diagnosis; the
    // panel keeps its standing line instead of inventing one.
    expect(failureAdvice({ criteria: { completeness: 1, cleanliness: 1, placement: 1 } }, 'cued')).toBeNull();
    expect(failureAdvice(null, 'cued')).toBeNull();
  });

  it('ignores a criterion the ask did not carry', () => {
    // Placement does not exist on a free rung; a missing number is not a zero.
    expect(failureAdvice({ criteria: { completeness: 1, cleanliness: 1 } }, 'free')).toBeNull();
  });
});
