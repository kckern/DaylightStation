import { describe, expect, it } from 'vitest';
import { validateUnit, isPlaceholderUnit } from "./unitValidation.mjs";

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

  // Owner rule (2026-11-11): a date-bound activity with instructions is a real
  // assignment that counts; with none it is a placeholder. One rule for the
  // panel's writes and for hand-edited files.
  it('makes a date-bound unit with instructions a real, counting unit — even if the file still says placeholder', () => {
    const { bank: _bank, ...noContent } = base;
    for (const flag of [{}, { placeholder: true }]) {
      const { errors, unit } = validateUnit({ ...noContent, onDays: ['2026-11-26'], description: 'Write five things.', ...flag }, sets);
      expect(errors).toEqual([]);
      expect(unit).not.toHaveProperty('placeholder');
    }
  });

  it('makes a date-bound unit with no content and no instructions a placeholder, flag or not', () => {
    const { bank: _bank, ...noContent } = base;
    const { errors, unit } = validateUnit({ ...noContent, onDays: ['2026-11-26'] }, sets);
    expect(errors).toEqual([]);
    expect(unit.placeholder).toBe(true);
    expect(validateUnit({ ...noContent, onDays: ['2026-11-26'], placeholder: false }, sets).unit.placeholder).toBe(true);
  });

  it('still refuses an undated unit with only instructions', () => {
    const { bank: _bank, ...noContent } = base;
    expect(validateUnit({ ...noContent, description: 'Do a thing.' }, sets).errors.join()).toMatch(/must reference/);
  });

  it('isPlaceholderUnit: placeholder = no instructions (trimmed)', () => {
    const { bank: _bank, ...noContent } = base;
    const dated = { ...noContent, onDays: ['2026-11-26'] };
    expect(isPlaceholderUnit(dated)).toBe(true);
    expect(isPlaceholderUnit({ ...dated, description: '   ' })).toBe(true);
    expect(isPlaceholderUnit({ ...dated, description: 'Go.', placeholder: true })).toBe(false);
    expect(isPlaceholderUnit({ ...base, onDays: ['2026-11-26'] })).toBe(false);
  });

  it('omits both fields from an ordinary unit', () => {
    const { unit } = validateUnit(base, sets);
    expect(unit).not.toHaveProperty('onDays');
    expect(unit).not.toHaveProperty('placeholder');
  });
});
