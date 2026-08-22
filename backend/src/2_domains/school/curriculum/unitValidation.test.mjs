import { describe, expect, it } from 'vitest';
import { validateUnit } from './unitValidation.mjs';

const base = {
  schema: 'school.unit/v1', unitId: 'chapter-two', title: 'Chapter Two', subject: 'science',
  objectives: ['Identify an atom.'], bank: 'science/atoms/chapter-two',
  provenance: { source: 'Printed chemistry book', reviewState: 'approved' },
};
const sets = { bankIds: new Set(['science/atoms/chapter-two']) };

describe('unit learner-facing reading metadata', () => {
  it('retains a concrete reading locator and print-book citation', () => {
    const { errors, unit } = validateUnit({
      ...base, reading: 'Chapter 2, pages 8–10', sourceTitle: 'A Printed Chemistry Book',
    }, sets);
    expect(errors).toEqual([]);
    expect(unit).toMatchObject({
      reading: 'Chapter 2, pages 8–10', sourceTitle: 'A Printed Chemistry Book',
    });
  });

  it('refuses a placeholder or digital sidecar as learner-facing reading metadata', () => {
    expect(validateUnit({ ...base, reading: 'assigned section' }, sets).errors)
      .toContainEqual(expect.stringMatching(/real section or page/));
    expect(validateUnit({ ...base, sourceTitle: 'Chemistry EPUB' }, sets).errors)
      .toContainEqual(expect.stringMatching(/digital sidecar/));
  });

  it('accepts a non-empty companion-source bibliography', () => {
    const { errors } = validateUnit({
      ...base,
      provenance: {
        sources: ['Primary printed source', 'Companion reference'],
        reviewState: 'approved',
      },
    }, sets);
    expect(errors).toEqual([]);
  });
});
