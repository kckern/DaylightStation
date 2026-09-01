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

  it('carries the named school day through as metadata, case-folded', () => {
    const { errors, unit } = validateUnit({ ...base, weekday: 'Monday' }, sets);
    expect(errors).toEqual([]);
    expect(unit.weekday).toBe('monday');
  });

  it('omits weekday entirely when a course is not built around named days', () => {
    const { errors, unit } = validateUnit(base, sets);
    expect(errors).toEqual([]);
    expect(unit).not.toHaveProperty('weekday');
  });

  it('refuses a weekday that is not a day, rather than dropping it silently', () => {
    expect(validateUnit({ ...base, weekday: 'day 1' }, sets).errors)
      .toContainEqual(expect.stringMatching(/weekday must be one of/));
    expect(validateUnit({ ...base, weekday: 3 }, sets).errors)
      .toContainEqual(expect.stringMatching(/weekday must be one of/));
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

  it('normalizes one primary and bounded alternate physical-book references', () => {
    const { errors, unit } = validateUnit({
      ...base,
      studyReferences: [
        { role: 'primary', title: 'Beast Academy 2A Guide', pages: [27, 24, 25, 26], section: 'Ones, Tens, Hundreds' },
        { role: 'alternate', title: 'Beast Academy 2A Practice', pages: [14, 15], section: 'Place Value Practice' },
      ],
    }, sets);
    expect(errors).toEqual([]);
    expect(unit.studyReferences).toEqual([
      { role: 'primary', title: 'Beast Academy 2A Guide', pages: [24, 25, 26, 27], section: 'Ones, Tens, Hundreds' },
      { role: 'alternate', title: 'Beast Academy 2A Practice', pages: [14, 15], section: 'Place Value Practice' },
    ]);
  });

  it('refuses malformed or ambiguous study references', () => {
    const malformed = validateUnit({
      ...base,
      studyReferences: [
        { role: 'alternate', title: 'Workbook PDF', pages: [0, 2], section: '' },
        { role: 'alternate', title: 'Other book', pages: [3], section: 'A section' },
      ],
    }, sets).errors;
    expect(malformed).toEqual(expect.arrayContaining([
      expect.stringMatching(/physical book/), expect.stringMatching(/positive integers/),
      expect.stringMatching(/section/), expect.stringMatching(/exactly one primary/),
      expect.stringMatching(/\[0\] must be the primary/),
    ]));
  });
});

describe('unit worksheet worked examples', () => {
  const worksheet = {
    examples: [{
      id: 'digit-value', title: 'Worked example', appliesTo: { concepts: ['place-value'] },
      question: {
        type: 'multiple_choice',
        prompt: 'In 364, what value does the digit 6 represent?',
        choices: ['6', '60', '600'],
      },
      solution: {
        steps: ['The digit 6 is in the tens place.', 'Six tens equal 60.'],
        answer: '60',
      },
    }],
  };

  it('normalizes a bounded, solved, representative worksheet example', () => {
    const { errors, unit } = validateUnit({ ...base, worksheet }, sets);
    expect(errors).toEqual([]);
    expect(unit.worksheet).toEqual(worksheet);
  });

  it('refuses examples that are unsolved, unanswerable, or arbitrary document blocks', () => {
    const invalid = structuredClone(worksheet);
    invalid.examples[0].solution.answer = '30';
    invalid.examples[0].blocks = [{ type: 'rich_text', md: 'Bypass the compact renderer.' }];
    expect(validateUnit({ ...base, worksheet: invalid }, sets).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown fields blocks/),
      expect.stringMatching(/answer must appear in question\.choices/),
    ]));
  });

  it('requires short structured reasoning instead of an unbounded mini-lesson', () => {
    const invalid = structuredClone(worksheet);
    invalid.examples[0].solution.steps = ['one', 'two', 'three', 'four'];
    invalid.examples[0].question.choices = ['60', '60'];
    expect(validateUnit({ ...base, worksheet: invalid }, sets).errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/steps must contain 1\.\.3/),
      expect.stringMatching(/choices must contain 2\.\.5 unique/),
    ]));
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
