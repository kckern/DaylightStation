import { describe, it, expect } from 'vitest';
import { SUBJECTS, groupBySubject } from './subjects.js';

describe('SUBJECTS', () => {
  it('is the six agreed shelves in order', () => {
    expect(SUBJECTS.map((s) => s.id)).toEqual([
      'reading', 'civilization', 'language', 'math', 'science', 'writing',
    ]);
  });
});

describe('groupBySubject', () => {
  const materials = [
    { id: 'm1', label: 'Shakespeare Tales', category: 'course', subject: 'reading' },
    { id: 'm2', label: 'I Survived', category: 'listening', subject: null },
    { id: 'm3', label: 'Atlas', category: 'reference', subject: 'civilization' },
    { id: 'm4', label: 'Art Lessons', category: 'course', subject: 'bogus-subject' },
  ];
  const banks = [
    { id: 'b1', title: 'US State Capitals', subject: 'civilization' },
    { id: 'b2', title: 'Times Tables', subject: 'math' },
    { id: 'b3', title: 'Party Trivia', subject: null },
  ];
  const courses = [
    { id: 'glossika-korean', label: 'Glossika Korean' },
  ];

  const grouped = groupBySubject({ materials, banks, courses });

  it('routes subject-tagged materials and banks to their shelf', () => {
    expect(grouped.bySubject.reading.materials.map((m) => m.id)).toEqual(['m1']);
    expect(grouped.bySubject.civilization.banks.map((b) => b.id)).toEqual(['b1']);
    expect(grouped.bySubject.math.banks.map((b) => b.id)).toEqual(['b2']);
  });

  it('reference-category material goes to the Library even when subject-tagged', () => {
    expect(grouped.library.materials.map((m) => m.id)).toContain('m3');
    expect(grouped.bySubject.civilization.materials).toEqual([]);
  });

  it('untagged or unknown-subject content lands in the Library', () => {
    expect(grouped.library.materials.map((m) => m.id)).toEqual(expect.arrayContaining(['m2', 'm4']));
    expect(grouped.library.banks.map((b) => b.id)).toEqual(['b3']);
  });

  it('language courses always shelve under language', () => {
    expect(grouped.bySubject.language.courses.map((c) => c.id)).toEqual(['glossika-korean']);
  });

  it('empty inputs produce empty shelves, not crashes', () => {
    const g = groupBySubject({});
    expect(g.bySubject.writing).toEqual({ materials: [], banks: [], courses: [] });
    expect(g.library).toEqual({ materials: [], banks: [] });
  });

  it('flags which subjects have any content', () => {
    expect(grouped.bySubject.reading.empty).toBeUndefined(); // no such field — use helper
    expect(grouped.bySubject.writing.materials.length + grouped.bySubject.writing.banks.length + grouped.bySubject.writing.courses.length).toBe(0);
  });
});
