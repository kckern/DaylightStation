import { describe, expect, it } from 'vitest';
import { informativeProgressRows } from './progressRows.mjs';

const course = (total, completed = 0) => ({ scope: 'course', label: 'Course', completed, total });
const unit = (total, completed = 0) => ({ scope: 'unit', label: 'Reading Music', completed, total });

describe('informativeProgressRows', () => {
  it('drops the course bar of a one-unit course, keeping the unit that is the real journey', () => {
    // Printed live: a solid COURSE 1 of 1 above READING MUSIC 29 of 53.
    expect(informativeProgressRows([course(1, 1), unit(53, 29)])).toEqual([unit(53, 29)]);
  });

  it('drops it whether or not the single unit is finished', () => {
    expect(informativeProgressRows([course(1, 0)])).toEqual([]);
    expect(informativeProgressRows([course(1, 1)])).toEqual([]);
  });

  it('keeps the course bar as soon as there are two units to move between', () => {
    expect(informativeProgressRows([course(2, 1), unit(53, 29)])).toHaveLength(2);
  });

  it('keeps a one-lesson UNIT bar, where "0 of 1" is a real not-yet', () => {
    expect(informativeProgressRows([unit(1, 0)])).toEqual([unit(1, 0)]);
  });

  it('keeps a one-total row from a producer that names no scope', () => {
    const unscoped = { label: 'Book', completed: 0, total: 1 };
    expect(informativeProgressRows([unscoped])).toEqual([unscoped]);
  });

  it.each([
    ['a missing total', { scope: 'unit', label: 'x', completed: 1 }],
    ['a zero total', { scope: 'unit', label: 'x', completed: 0, total: 0 }],
    ['a negative total', { scope: 'unit', label: 'x', completed: 0, total: -3 }],
    ['a fractional total', { scope: 'unit', label: 'x', completed: 0, total: 2.5 }],
  ])('still refuses %s — a bar with no denominator', (_label, row) => {
    expect(informativeProgressRows([row])).toEqual([]);
  });

  it.each([
    ['null', null], ['undefined', undefined], ['an empty list', []], ['a list of holes', [null, undefined]],
  ])('answers with an empty list for %s', (_label, rows) => {
    expect(informativeProgressRows(rows)).toEqual([]);
  });

  it('accepts a single row that is not in a list, as both renderers may pass one', () => {
    expect(informativeProgressRows(unit(53, 29))).toEqual([unit(53, 29)]);
    expect(informativeProgressRows(course(1, 1))).toEqual([]);
  });
});
