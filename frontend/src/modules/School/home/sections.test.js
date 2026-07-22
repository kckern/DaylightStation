import { describe, it, expect } from 'vitest';
import { SECTIONS, sectionsFromCatalog } from './sections.js';

describe('sectionsFromCatalog', () => {
  it('appends catalog sections after the built-ins, with cat: ids and known hints', () => {
    const result = sectionsFromCatalog([
      { category: 'course', label: 'Courses' },
      { category: 'listening', label: 'Listening' },
    ]);
    expect(result).toEqual([
      ...SECTIONS,
      { id: 'cat:course', label: 'Courses', hint: 'Watch, listen, and pass the quiz' },
      { id: 'cat:listening', label: 'Listening', hint: 'Stories and audiobooks' },
    ]);
  });

  it('an unknown category still renders, with no hint', () => {
    const result = sectionsFromCatalog([{ category: 'writing', label: 'Writing' }]);
    const tile = result.find((s) => s.id === 'cat:writing');
    expect(tile).toEqual({ id: 'cat:writing', label: 'Writing', hint: undefined });
  });

  it('an empty/missing catalog leaves only the built-ins', () => {
    expect(sectionsFromCatalog([])).toEqual(SECTIONS);
    expect(sectionsFromCatalog(undefined)).toEqual(SECTIONS);
  });
});
