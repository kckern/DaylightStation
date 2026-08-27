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

// A gated media lesson: the video is the content, the bank holds the
// comprehension items, and `checkpoints` says where playback stops to ask
// them. All three are required together — see `mediaCheckpoints.mjs`.
const gated = {
  schema: 'school.unit/v1', unitId: 'astronomy-e03', title: 'Astronomy, Episode 3', subject: 'science',
  media: 'astronomy-e03', bank: 'astronomy-3',
  checkpoints: [{ at: 312, items: ['ast3-q4', 'ast3-q7'] }, { at: 741, items: ['ast3-q9'] }],
  provenance: { source: 'hand-authored', reviewState: 'approved' },
};
const gatedSets = {
  bankIds: new Set(['astronomy-3']),
  manifestIds: new Set(['astronomy-e03']),
};

describe('unit checkpoints block', () => {
  it('accepts media + bank + checkpoints and carries the normalized block', () => {
    const { errors, unit } = validateUnit(gated, gatedSets);
    expect(errors).toEqual([]);
    expect(unit.checkpoints).toEqual([
      { id: 'cp-312', at: 312, items: ['ast3-q4', 'ast3-q7'] },
      { id: 'cp-741', at: 741, items: ['ast3-q9'] },
    ]);
  });

  it('requires media and bank as two separate, field-named errors', () => {
    expect(validateUnit({ ...gated, media: undefined }, gatedSets).errors)
      .toContain('checkpoints requires media');
    expect(validateUnit({ ...gated, bank: undefined }, gatedSets).errors)
      .toContain('checkpoints requires bank');
    const neither = validateUnit({ ...gated, media: undefined, bank: undefined, document: 'd' }, gatedSets).errors;
    expect(neither).toContain('checkpoints requires media');
    expect(neither).toContain('checkpoints requires bank');
  });

  it('surfaces the inner validator errors, prefixed', () => {
    const errors = validateUnit({ ...gated, checkpoints: [{ at: 0, items: [] }] }, gatedSets).errors;
    expect(errors).toContainEqual(expect.stringMatching(/^checkpoints: checkpoints\[0\]\.at must be an integer >= 1/));
    expect(errors).toContainEqual(expect.stringMatching(/^checkpoints: checkpoints\[0\]\.items must be a non-empty array/));
    expect(validateUnit({ ...gated, checkpoints: 'nope' }, gatedSets).errors)
      .toContain('checkpoints: checkpoints must be a non-empty array');
  });

  it('resolves item ids only when the caller injects bankItems, shape-only otherwise', () => {
    const withItems = {
      ...gatedSets,
      bankItems: new Map([['astronomy-3', new Set(['ast3-q4', 'ast3-q7', 'ast3-q9'])]]),
    };
    expect(validateUnit(gated, withItems).errors).toEqual([]);
    const ghost = { ...gated, checkpoints: [{ at: 312, items: ['ast3-ghost'] }] };
    expect(validateUnit(ghost, withItems).errors)
      .toContain("checkpoints: checkpoints[0].items: 'ast3-ghost' not found in bank");
    // No set injected — the domain has no repository, so shape only.
    expect(validateUnit(ghost, gatedSets).errors).toEqual([]);
    // A bankItems Map that simply has no entry for THIS bank degrades to
    // shape-only too, rather than failing every item as missing.
    expect(validateUnit(ghost, { ...gatedSets, bankItems: new Map() }).errors).toEqual([]);
  });

  it('leaves every checkpoint-less unit exactly as it was — no key, not an undefined one', () => {
    const { errors, unit } = validateUnit(base, sets);
    expect(errors).toEqual([]);
    expect('checkpoints' in unit).toBe(false);
  });
});
