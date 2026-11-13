// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateEntryIcon, programEntryIcon } from "./entryIcon.mjs";

describe('validateEntryIcon', () => {
  it('keeps a trimmed name and treats absence as none', () => {
    expect(validateEntryIcon('  crayon ')).toEqual({ errors: [], icon: 'crayon' });
    expect(validateEntryIcon(undefined)).toEqual({ errors: [], icon: null });
    expect(validateEntryIcon(null)).toEqual({ errors: [], icon: null });
  });

  it('refuses a non-string or a blank', () => {
    for (const bad of [3, true, {}, ['music'], '   ']) {
      expect(validateEntryIcon(bad).errors).toHaveLength(1);
    }
  });
});

describe('programEntryIcon', () => {
  it('defaults piano-course to music and school-debrief to keyboard, and leaves other programs to the shelf', () => {
    expect(programEntryIcon('piano-course')).toBe('music');
    expect(programEntryIcon('piano-course', 'piano')).toBe('piano');
    expect(programEntryIcon('school-debrief')).toBe('keyboard');
    expect(programEntryIcon('school-debrief', 'writing')).toBe('writing');
    expect(programEntryIcon('printed-activity')).toBeNull();
    expect(programEntryIcon('printed-activity', 'crayon')).toBe('crayon');
  });
});
