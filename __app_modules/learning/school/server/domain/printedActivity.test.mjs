import { describe, expect, it } from 'vitest';
import {
  PRINTED_ACTIVITY_PROGRAM_ID, validatePrintedActivityEnrollment, pickActivity, servedUnitId, printedActivityLabel,
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
  it('trims platform and kind, and refuses whitespace-only ones', () => {
    const { enrollment } = validatePrintedActivityEnrollment(entry({ activity: { platform: ' beeloo ', kind: ' maze ', level: 3 } }));
    expect(enrollment.activity).toMatchObject({ platform: 'beeloo', kind: 'maze' });
    expect(validatePrintedActivityEnrollment(entry({ activity: { platform: '  ', kind: 'maze', level: 3 } })).errors.join(' ')).toMatch(/platform/);
    expect(validatePrintedActivityEnrollment(entry({ activity: { platform: 'beeloo', kind: '  ', level: 3 } })).errors.join(' ')).toMatch(/kind/);
  });
  it.each([[{}], [''], ['   '], [42]])('keeps title only as a non-empty trimmed string (%o -> null)', (title) => {
    expect(validatePrintedActivityEnrollment(entry({ title })).enrollment.title).toBeNull();
  });
  it('trims a title', () => {
    expect(validatePrintedActivityEnrollment(entry({ title: '  Maze ' })).enrollment.title).toBe('Maze');
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
  it('keeps an optional icon, trimmed, and leaves it out when absent', () => {
    expect(validatePrintedActivityEnrollment(entry({ icon: ' crayon ' })).enrollment.icon).toBe('crayon');
    expect(validatePrintedActivityEnrollment(entry())).not.toHaveProperty('enrollment.icon');
  });
  it.each([[42], [''], [{}]])('refuses a non-string or blank icon (%o)', (icon) => {
    expect(validatePrintedActivityEnrollment(entry({ icon })).errors.join(' ')).toMatch(/icon/);
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
  it('accepts an array of excluded ids', () => {
    expect(pickActivity({ pool, exclude: ['a', 'c'], rng: () => 0 }).externalId).toBe('b');
  });
  it.each([undefined, null, 42])('refuses a missing or non-iterable exclude (%o)', (exclude) => {
    expect(() => pickActivity({ pool, exclude, rng: () => 0 })).toThrow(TypeError);
  });
  it('clamps an out-of-range rng into the pool', () => {
    expect(pickActivity({ pool, exclude: new Set(), rng: () => -0.5 }).externalId).toBe('a');
    expect(pickActivity({ pool, exclude: new Set(), rng: () => 1 }).externalId).toBe('c');
  });
  it('requires an rng', () => {
    expect(() => pickActivity({ pool, exclude: new Set() })).toThrow(/rng/);
  });
});

it('servedUnitId is stable per corpus', () => {
  expect(servedUnitId('beeloo:maze')).toBe('printed-activity:beeloo:maze');
});

describe('printedActivityLabel', () => {
  it('prefers the title, then the capitalised kind, then a generic name', () => {
    expect(printedActivityLabel({ title: ' Maze ', activity: { kind: 'sudoku' } })).toBe('Maze');
    expect(printedActivityLabel({ title: null, activity: { kind: 'sudoku' } })).toBe('Sudoku');
    expect(printedActivityLabel({})).toBe('Printed activity');
  });
});
