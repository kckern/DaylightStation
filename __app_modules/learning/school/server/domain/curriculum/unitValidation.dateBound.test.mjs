import { describe, expect, it } from 'vitest';
import { validateUnit } from "./unitValidation.mjs";

const base = {
  schema: 'school.unit/v1', unitId: 'chapter-two', title: 'Chapter Two', subject: 'science',
  objectives: ['Identify an atom.'], bank: 'science/atoms/chapter-two',
  provenance: { source: 'Printed chemistry book', reviewState: 'approved' },
};
const sets = { bankIds: new Set(['science/atoms/chapter-two']) };

describe('date-bound and placeholder units', () => {
  it('accepts onDays (dates and spans) and placeholder on a standalone unit', () => {
    const { errors, unit } = validateUnit({
      ...base, onDays: ['2026-11-11', { from: '2026-12-24', to: '2026-12-25' }], placeholder: true,
    }, sets);
    expect(errors).toEqual([]);
    expect(unit.onDays).toEqual([{ from: '2026-11-11', to: '2026-11-11' }, { from: '2026-12-24', to: '2026-12-25' }]);
    expect(unit.placeholder).toBe(true);
  });

  it('accepts onDays on a course unit', () => {
    expect(validateUnit({ ...base, courseId: 'civ', sequence: 4, onDays: ['2026-11-11'] }, sets).errors).toEqual([]);
  });

  it.each([
    ['an empty onDays', { onDays: [] }, /onDays/],
    ['an invalid date', { onDays: ['2026-13-01'] }, /onDays/],
    ['a non-boolean placeholder', { placeholder: 'yes' }, /placeholder/],
  ])('refuses %s', (_label, over, message) => {
    expect(validateUnit({ ...base, ...over }, sets).errors.join()).toMatch(message);
  });

  it('lets a date-bound placeholder stand with no content yet, but only a date-bound one', () => {
    const { bank: _bank, ...noContent } = base;
    expect(validateUnit({ ...noContent, onDays: ['2026-11-26'], placeholder: true }, sets).errors).toEqual([]);
    expect(validateUnit({ ...noContent, placeholder: true }, sets).errors.join()).toMatch(/onDays/);
  });

  it('omits both fields from an ordinary unit', () => {
    const { unit } = validateUnit(base, sets);
    expect(unit).not.toHaveProperty('onDays');
    expect(unit).not.toHaveProperty('placeholder');
  });
});
