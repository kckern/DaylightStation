import { describe, expect, it } from 'vitest';
import { worksheetPresentation } from '#domains/school/curriculum/worksheetPresentation.mjs';

const work = {
  work: 'cfm', title: 'Come Follow Me — Old Testament 2026', short_title: 'Come Follow Me',
  progression: { module_number_start: 35 },
  source: {
    title: 'Come, Follow Me — For Home and Church: Old Testament 2026',
    reader: { title: 'NIrV Adventure Bible for Early Readers' },
  },
  modules: [{ module: 'w35', title: 'Aug 24–30 · Psalms 49–86', short_title: 'Psalms 49–86' }],
};

describe('worksheet lesson-card presentation', () => {
  it('uses the configured reader display title, never the course pacing source or edition metadata', () => {
    const result = worksheetPresentation({ work, unit: {
      courseId: 'cfm', module: 'w35', title: 'Tuesday · Psalms 62–66, 69',
      description: 'Weekday 2.',
      provenance: {
        source: 'NIrV Adventure Bible for Early Readers (Revised, 2008)',
        printed_pages: [681, 682, 683, 684, 685, 686],
      },
    } });
    expect(result).toEqual({
      breadcrumb: 'Come Follow Me › Unit 35 · Psalms 49–86',
      sourceTitle: 'NIrV Adventure Bible for Early Readers',
      reading: null,
      printedPages: [681, 682, 683, 684, 685, 686],
      citation: 'Weekday 2.',
    });
    expect(JSON.stringify(result)).not.toContain('For Home and Church');
    expect(JSON.stringify(result)).not.toContain('Revised, 2008');
  });

  it('allows an explicit unit display source to override the course reader title', () => {
    expect(worksheetPresentation({ work, unit: {
      courseId: 'cfm', module: 'w35', sourceTitle: 'Large Print NIrV', provenance: {},
    } }).sourceTitle).toBe('Large Print NIrV');
  });

  it('falls back to unit provenance when no reader display title is configured', () => {
    expect(worksheetPresentation({
      work: { ...work, source: {} },
      unit: {
        courseId: 'cfm', module: 'w35',
        provenance: { source: 'NIrV Adventure Bible for Early Readers (Revised, 2008)' },
      },
    }).sourceTitle).toBe('NIrV Adventure Bible for Early Readers (Revised, 2008)');
  });

  it('keeps an explicit reading instruction only when there are no page locators', () => {
    expect(worksheetPresentation({ work, unit: {
      courseId: 'cfm', module: 'w35', reading: 'the assigned introduction.', provenance: {},
    } }).reading).toBe('Read: the assigned introduction.');
  });

  it('formats primary and alternate physical-book references as optional guidance', () => {
    expect(worksheetPresentation({ unit: {
      courseId: 'elementary-math-2-3', module: 'number-sense',
      studyReferences: [
        { role: 'primary', title: 'Beast Academy 2A Guide', pages: [24, 25, 26, 27], section: 'Ones, Tens, Hundreds' },
        { role: 'alternate', title: 'Beast Academy 2A Practice', pages: [14, 15], section: 'Place Value Practice' },
      ],
      provenance: { source: 'Original parallel practice' },
    } }).reading).toBe(
      'Reference if needed: Beast Academy 2A Guide, pp. 24–27 — Ones, Tens, Hundreds. '
      + 'Also: Beast Academy 2A Practice, pp. 14–15 — Place Value Practice.',
    );
  });

  it('preserves the legacy printed-page presentation when no study references exist', () => {
    expect(worksheetPresentation({
      unit: { title: 'Kansas', provenance: { source: 'Atlas', printed_pages: [50, 51] } },
    })).toMatchObject({ sourceTitle: 'Atlas', printedPages: [50, 51], reading: null });
  });
});
