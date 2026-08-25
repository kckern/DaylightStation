import { describe, expect, it } from 'vitest';
import { compactCourseModuleLabel, courseDisplay, moduleDisplay } from '#domains/school/curriculum/display.mjs';

const work = {
  work: 'come-follow-me-ot-2026',
  title: 'Come Follow Me — Old Testament 2026',
  short_title: 'Come Follow Me',
  progression: { module_number_start: 35 },
  modules: [
    { module: 'w35-aug24', title: 'Aug 24–30 · Psalms 49–86', short_title: 'Psalms 49–86' },
    { module: 'w36-aug31', title: 'Aug 31–Sep 6 · Psalms 102–150', short_title: 'Psalms 102–150' },
    { module: 'w37-sep07', title: 'Sep 7–13 · Proverbs; Ecclesiastes', short_title: 'Proverbs & Ecclesiastes' },
  ],
};

describe('curriculum display projection', () => {
  it('keeps ids, compact labels, full titles, and displayed numbers distinct', () => {
    expect(courseDisplay({ work })).toEqual({
      title: 'Come Follow Me — Old Testament 2026', shortTitle: 'Come Follow Me',
    });
    expect(moduleDisplay({ work, moduleId: 'w35-aug24' })).toMatchObject({
      number: 35,
      title: 'Aug 24–30 · Psalms 49–86',
      shortTitle: 'Psalms 49–86',
      taxonomyLabel: 'Unit 35: Aug 24–30 · Psalms 49–86',
      progressLabel: 'Psalms 49–86',
    });
    expect(compactCourseModuleLabel({ work, moduleId: 'w35-aug24' }))
      .toBe('Come Follow Me › Unit 35 · Psalms 49–86');
  });

  it('numbers against authored course order even when enrollment begins later', () => {
    const enrollment = { moduleOrder: ['w37-sep07'] };
    expect(moduleDisplay({ work, enrollment, moduleId: 'w37-sep07' }).number).toBe(37);
  });

  it('honors an explicit module number over the course start', () => {
    const override = { ...work, modules: [{ ...work.modules[0], number: 80 }] };
    expect(moduleDisplay({ work: override, moduleId: 'w35-aug24' }).number).toBe(80);
  });

  it('uses a frozen enrollment display snapshot before mutable catalog labels', () => {
    const enrollment = {
      display: {
        courseTitle: 'Frozen full title', courseShortTitle: 'Frozen short',
        modules: { 'w35-aug24': { number: 42, title: 'Frozen unit', shortTitle: 'Frozen topic' } },
      },
    };
    expect(courseDisplay({ work, enrollment })).toEqual({ title: 'Frozen full title', shortTitle: 'Frozen short' });
    expect(moduleDisplay({ work, enrollment, moduleId: 'w35-aug24' })).toMatchObject({
      number: 42, title: 'Frozen unit', shortTitle: 'Frozen topic',
    });
  });

  it('does not infer labels or numbers from a kebab id', () => {
    const enrollment = { moduleOrder: ['w99-mystery'] };
    expect(moduleDisplay({ enrollment, moduleId: 'w99-mystery' })).toMatchObject({
      number: 1, shortTitle: 'Unit',
    });
  });
});
