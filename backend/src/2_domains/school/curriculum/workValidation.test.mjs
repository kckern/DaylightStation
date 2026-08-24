import { describe, expect, it } from 'vitest';
import { validateWork } from './workValidation.mjs';

const courseV2 = {
  schema: 'school.course/v2', poster: 'poster.jpg', work: 'molecules', title: 'Molecules', subject: 'science',
  category: 'course', medium: 'paper',
  structure: { shape: 'modules', module: 'chapter', items: { from: 'units', order: 'sequence' } },
  grading: { gate: 'omr', scope: 'item', pass_percent: 80, exit: 'Complete each chapter.' },
  source: { title: 'Molecules: The Elements and the Architecture of Everything', year: 2014 },
};

describe('validateWork — school.course/v2', () => {
  it('accepts per-lesson OMR and the course schema’s concise bibliographic source', () => {
    const result = validateWork(courseV2, { subject: 'science', work: 'molecules' });
    expect(result.errors).toEqual([]);
    expect(result.work).toMatchObject({ work: 'molecules', source: { title: expect.stringContaining('Molecules') } });
  });

  it('accepts a multi-publication course source list and e-book source medium', () => {
    const result = validateWork({
      ...courseV2, work: 'myths', title: 'Myths', subject: 'english', medium: 'ebook', source: undefined,
      sources: [{ title: 'Book one', publisher: 'Publisher' }, { title: 'Book two' }],
    }, { subject: 'english', work: 'myths' });
    expect(result.errors).toEqual([]);
    expect(result.work.sources).toHaveLength(2);
  });

  it('keeps legacy work.yml source requirements intact', () => {
    const legacy = { ...courseV2, schema: undefined, source: { title: 'Incomplete source' } };
    expect(validateWork(legacy, { subject: 'science', work: 'molecules' }).errors)
      .toContain('source requires title, publisher, and isbn');
  });
});
