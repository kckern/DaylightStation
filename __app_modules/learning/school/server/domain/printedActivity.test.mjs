import { describe, expect, it } from 'vitest';
import {
  PRINTED_ACTIVITY_PROGRAM_ID, validatePrintedActivityEnrollment, pickActivity, servedUnitId,
} from './printedActivity.mjs';

const entry = (over = {}) => ({
  programId: 'printed-activity', corpusId: 'beeloo:maze', subject: 'arts', title: 'Maze', target: 1,
  activity: { platform: 'beeloo', kind: 'maze', level: 3, paper: 'letter' }, ...over,
});

describe('validatePrintedActivityEnrollment', () => {
  it('accepts the maze entry', () => {
    expect(validatePrintedActivityEnrollment(entry())).toEqual({ errors: [], enrollment: entry() });
  });
  it('exports the program id', () => {
    expect(PRINTED_ACTIVITY_PROGRAM_ID).toBe('printed-activity');
  });
  it('defaults target to 1 and paper to letter', () => {
    const { enrollment } = validatePrintedActivityEnrollment(entry({ target: undefined, activity: { platform: 'beeloo', kind: 'maze', level: 3 } }));
    expect(enrollment.target).toBe(1);
    expect(enrollment.activity.paper).toBe('letter');
  });
  it('answers title null when absent', () => {
    const { title, ...rest } = entry();
    expect(validatePrintedActivityEnrollment(rest).enrollment.title).toBeNull();
  });
  it('does not copy unknown keys into the enrollment', () => {
    const { enrollment } = validatePrintedActivityEnrollment(entry({
      schedule: { daysOfWeek: [1] }, stray: true,
      activity: { platform: 'beeloo', kind: 'maze', level: 3, paper: 'a4', extra: 'x' },
    }));
    expect(enrollment).not.toHaveProperty('stray');
    expect(enrollment).not.toHaveProperty('schedule');
    expect(enrollment.activity).toEqual({ platform: 'beeloo', kind: 'maze', level: 3, paper: 'a4' });
  });
  it.each([null, 'maze', [entry()]])('refuses a non-mapping %o', (raw) => {
    expect(validatePrintedActivityEnrollment(raw).errors.join(' ')).toMatch(/mapping/);
  });
  it.each([
    [{ corpusId: null }, /corpusId/],
    [{ subject: 'recess' }, /subject/],
    [{ target: 0 }, /target/],
    [{ activity: { platform: 'beeloo', kind: '', level: 3 } }, /kind/],
    [{ activity: { platform: 'beeloo', kind: 'maze', level: 'easy' } }, /level/],
    [{ activity: { kind: 'maze', level: 3 } }, /platform/],
    [{ activity: { platform: 'beeloo', kind: 'maze', level: 3, paper: 'a3' } }, /paper/],
  ])('refuses %o', (over, msg) => {
    expect(validatePrintedActivityEnrollment(entry(over)).errors.join(' ')).toMatch(msg);
  });
});

describe('pickActivity', () => {
  const pool = [{ externalId: 'a' }, { externalId: 'b' }, { externalId: 'c' }];
  it('never picks an excluded page', () => {
    expect(pickActivity({ pool, exclude: new Set(['a', 'b']), rng: () => 0 }).externalId).toBe('c');
  });
  it('answers null when the pool is exhausted', () => {
    expect(pickActivity({ pool, exclude: new Set(['a', 'b', 'c']), rng: () => 0 })).toBeNull();
  });
  it('is uniform over what is left', () => {
    expect(pickActivity({ pool, exclude: new Set(), rng: () => 0.99 }).externalId).toBe('c');
  });
  it('requires an rng', () => {
    expect(() => pickActivity({ pool, exclude: new Set() })).toThrow(/rng/);
  });
});

it('servedUnitId is stable per corpus', () => {
  expect(servedUnitId('beeloo:maze')).toBe('printed-activity:beeloo:maze');
});
