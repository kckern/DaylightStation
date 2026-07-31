import { describe, it, expect } from 'vitest';
import { GRADES } from '#domains/school/grades.mjs';
import { SUBJECT_IDS, isPublishable, validateUnit } from '#domains/school/curriculum/unitValidation.mjs';
// The real registered adapter, not a hand-rolled stand-in: `launch:` validation
// exists precisely so a unit cannot publish naming a surface/payload its own
// adapter would reject at dispatch time, and a fake validator could drift from
// that contract without anyone noticing.
import { GarageFitnessSurface } from '#apps/donow/surfaces/GarageFitnessSurface.mjs';

const refs = () => ({
  bankIds: new Set(['math-fractions']),
  documentIds: new Set(['math-fractions-01-ws']),
  manifestIds: new Set(['liberty-kids-01']),
  programIds: new Set(['language']),
});

const valid = (over = {}) => ({
  unitId: 'math-3.4',
  title: 'Adding fractions with unlike denominators',
  subject: 'math',
  document: 'math-fractions-01-ws',
  provenance: { source: 'hand-authored', reviewState: 'draft' },
  ...over,
});

const errs = (raw, sets = refs()) => validateUnit(raw, sets).errors;
const unitOf = (raw, sets = refs()) => validateUnit(raw, sets).unit;

describe('SUBJECT_IDS', () => {
  it('is the nine subject shelves, in wall order', () => {
    expect(SUBJECT_IDS).toEqual([
      'english', 'writing', 'math', 'history', 'scripture', 'science', 'language', 'skills', 'arts',
    ]);
  });

  it('is frozen — a new shelf is a curriculum decision, never config', () => {
    expect(Object.isFrozen(SUBJECT_IDS)).toBe(true);
  });
});

describe('validateUnit: shape', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'math-3.4'],
  ])('rejects a unit that is %s', (_label, raw) => {
    expect(errs(raw)).toEqual(['unit must be a mapping']);
  });

  it('returns the normalised unit only when it is valid', () => {
    expect(unitOf(valid())).toMatchObject({
      unitId: 'math-3.4',
      subject: 'math',
      document: 'math-fractions-01-ws',
    });
    expect(unitOf(valid({ title: '' }))).toBeUndefined();
  });

  it('treats absent reference sets as empty rather than throwing', () => {
    expect(() => validateUnit(valid(), {})).not.toThrow();
    expect(validateUnit(valid(), {}).errors).toContain("document 'math-fractions-01-ws' not found");
    expect(validateUnit(valid()).errors).toContain("document 'math-fractions-01-ws' not found");
  });
});

describe('validateUnit: identity', () => {
  it.each(['math-3.4', 'math', '3rs.reading.01', '0-start'])('accepts the unitId %s', (unitId) => {
    expect(errs(valid({ unitId }))).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' '],
    ['not a string', 34],
    ['missing', undefined],
  ])('rejects a unitId that is %s', (_label, unitId) => {
    expect(errs(valid({ unitId }))).toContain('unitId is required');
  });

  it.each([
    ['uppercase', 'Math-3.4'],
    ['a leading dot', '.math'],
    ['a leading hyphen', '-math'],
    ['a space', 'math 3.4'],
    ['a slash', 'math/3.4'],
  ])('rejects a unitId with %s', (_label, unitId) => {
    expect(errs(valid({ unitId }))).toContain(`unitId must match ^[a-z0-9][a-z0-9.-]*$, got: ${unitId}`);
  });

  it('requires a title', () => {
    expect(errs(valid({ title: '  ' }))).toContain('title is required');
    expect(errs(valid({ title: undefined }))).toContain('title is required');
  });
});

describe('validateUnit: subject', () => {
  it.each(['english', 'writing', 'math', 'history', 'scripture', 'science', 'language', 'skills', 'arts'])(
    'accepts the shelf %s',
    (subject) => {
      expect(errs(valid({ subject }))).toEqual([]);
    },
  );

  it('rejects an unknown subject, naming it', () => {
    expect(errs(valid({ subject: 'geography' })))
      .toContain('subject must be one of english|writing|math|history|scripture|science|language|skills|arts, got: geography');
  });

  it('requires a subject', () => {
    expect(errs(valid({ subject: undefined })))
      .toContain('subject must be one of english|writing|math|history|scripture|science|language|skills|arts, got: undefined');
  });
});

describe('validateUnit: objectives', () => {
  it('accepts an omitted list', () => {
    expect(errs(valid())).toEqual([]);
  });

  it('accepts an array of non-empty strings', () => {
    expect(errs(valid({ objectives: ['Find a common denominator', 'Add the numerators'] }))).toEqual([]);
  });

  it.each([
    ['not an array', 'Find a common denominator'],
    ['holding an empty string', ['ok', '   ']],
    ['holding a non-string', ['ok', { text: 'x' }]],
  ])('rejects objectives that are %s', (_label, objectives) => {
    expect(errs(valid({ objectives }))).toContain('objectives must be an array of non-empty strings');
  });
});

describe('validateUnit: placement', () => {
  it('accepts a standalone unit with no courseId and no sequence', () => {
    expect(errs(valid())).toEqual([]);
  });

  it('accepts a course member with a sequence', () => {
    expect(errs(valid({ courseId: 'math-3', sequence: 1 }))).toEqual([]);
  });

  it('requires a sequence when courseId is present', () => {
    expect(errs(valid({ courseId: 'math-3' })))
      .toContain('sequence is required when courseId is present');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['a numeric string', '1'],
  ])('rejects a sequence that is %s', (_label, sequence) => {
    expect(errs(valid({ courseId: 'math-3', sequence }))).toContain('sequence must be an integer >= 1');
  });

  it('rejects a sequence without a courseId — a standalone unit has no position', () => {
    expect(errs(valid({ sequence: 1 })))
      .toContain('sequence is only meaningful inside a course (courseId is missing)');
  });

  it('rejects a courseId that is not a non-empty string', () => {
    expect(errs(valid({ courseId: 7, sequence: 1 }))).toContain('courseId must be a non-empty string');
  });

  // Gating is implied by course membership alone (spec: "only sequential
  // courses gate"), so there is no gate field to carry a contradicting value.
  it('has no gate field in the normalised unit', () => {
    expect(unitOf(valid({ courseId: 'math-3', sequence: 1 }))).not.toHaveProperty('gate');
  });
});

describe('validateUnit: grades', () => {
  it('accepts an omitted list (applies at every rung)', () => {
    expect(unitOf(valid()).grades).toEqual([]);
  });

  it.each(GRADES)('accepts the ladder tier %s', (grade) => {
    expect(errs(valid({ grades: [grade] }))).toEqual([]);
  });

  it('rejects an unknown tier, naming it', () => {
    expect(errs(valid({ grades: ['lower', 'kindergarten'] })))
      .toContain(`grades entries must be one of ${GRADES.join('|')}, got: kindergarten`);
  });

  it('rejects grades that are not an array', () => {
    expect(errs(valid({ grades: 'lower' }))).toContain('grades must be an array');
  });
});

describe('validateUnit: policy', () => {
  it('defaults passing to 80 percent', () => {
    expect(unitOf(valid()).passing).toEqual({ percent: 80 });
  });

  it('accepts an explicit percent inside 1..100', () => {
    expect(unitOf(valid({ passing: { percent: 1 } })).passing).toEqual({ percent: 1 });
    expect(unitOf(valid({ passing: { percent: 100 } })).passing).toEqual({ percent: 100 });
  });

  it.each([
    ['zero', 0],
    ['above 100', 101],
    ['fractional', 79.5],
    ['a numeric string', '80'],
    ['missing', undefined],
  ])('rejects a passing percent that is %s', (_label, percent) => {
    expect(errs(valid({ passing: { percent } }))).toContain('passing.percent must be an integer between 1 and 100');
  });

  it.each([
    ['an array', []],
    ['a number', 80],
  ])('rejects passing that is %s', (_label, passing) => {
    expect(errs(valid({ passing }))).toContain('passing must be an object');
  });

  it('accepts a reward, defaulting requiresSignoff to false', () => {
    expect(unitOf(valid({ reward: { amount: 5 } })).reward).toEqual({ amount: 5, requiresSignoff: false });
    expect(unitOf(valid({ reward: { amount: 5, requiresSignoff: true } })).reward)
      .toEqual({ amount: 5, requiresSignoff: true });
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['fractional', 2.5],
    ['a numeric string', '5'],
    ['missing', undefined],
  ])('rejects a reward amount that is %s', (_label, amount) => {
    expect(errs(valid({ reward: { amount } }))).toContain('reward.amount must be an integer > 0');
  });

  it('rejects a non-boolean requiresSignoff', () => {
    expect(errs(valid({ reward: { amount: 5, requiresSignoff: 'yes' } })))
      .toContain('reward.requiresSignoff must be a boolean');
  });

  it('rejects a reward that is not an object', () => {
    expect(errs(valid({ reward: 5 }))).toContain('reward must be an object');
  });

  it('accepts a retry variant count >= 1', () => {
    expect(unitOf(valid({ retry: { variants: 3 } })).retry).toEqual({ variants: 3 });
  });

  it.each([
    ['zero', 0],
    ['fractional', 1.5],
    ['a numeric string', '3'],
    ['missing', undefined],
  ])('rejects a retry variants count that is %s', (_label, variants) => {
    expect(errs(valid({ retry: { variants } }))).toContain('retry.variants must be an integer >= 1');
  });

  it('rejects a retry that is not an object', () => {
    expect(errs(valid({ retry: 3 }))).toContain('retry must be an object');
  });

  it('omits reward and retry from the normalised unit when absent', () => {
    const unit = unitOf(valid());
    expect(unit.reward).toBeUndefined();
    expect(unit.retry).toBeUndefined();
  });
});

describe('validateUnit: composition references', () => {
  it('rejects a unit that composes nothing', () => {
    expect(errs(valid({ document: undefined })))
      .toContain('unit must reference at least one of bank, document, media, review');
  });

  it.each([
    ['bank', { bank: 'math-fractions' }],
    ['document', { document: 'math-fractions-01-ws' }],
    ['media', { media: 'liberty-kids-01' }],
    ['review', { review: 'Parent checks the handwriting sample against the rubric.' }],
  ])('accepts a unit composed of %s alone', (_kind, over) => {
    expect(errs(valid({ document: undefined, ...over }))).toEqual([]);
  });

  it('accepts every reference at once', () => {
    expect(errs(valid({
      bank: 'math-fractions',
      document: 'math-fractions-01-ws',
      media: 'liberty-kids-01',
      review: { rubric: 'neatness' },
    }))).toEqual([]);
  });

  it.each([
    ['bank', 'bank', 'math-mystery'],
    ['document', 'document', 'math-3.4-ws'],
    ['media', 'media', 'liberty-kids-99'],
  ])('reports a dangling %s reference by kind and id', (_label, kind, id) => {
    expect(errs(valid({ document: undefined, [kind]: id }))).toContain(`${kind} '${id}' not found`);
  });

  it.each(['bank', 'document', 'media'])('rejects a %s reference that is not a non-empty string', (kind) => {
    expect(errs(valid({ document: undefined, [kind]: 42 }))).toContain(`${kind} must be a non-empty string`);
  });

  // review is a free-form parent rubric for unscorable work — there is no set of
  // review IDs to resolve it against, so only its shape is checked.
  it.each([
    ['an empty string', ''],
    ['an array', []],
    ['a number', 7],
  ])('rejects a review that is %s', (_label, review) => {
    expect(errs(valid({ document: undefined, review })))
      .toContain('review must be a non-empty string or an object');
  });

  it('does not double-report a dangling reference as a missing composition', () => {
    expect(errs(valid({ document: 'nope' })))
      .not.toContain('unit must reference at least one of bank, document, media, review');
  });
});

describe('validateUnit: provenance', () => {
  it.each(['draft', 'approved'])('accepts the review state %s', (reviewState) => {
    expect(errs(valid({ provenance: { source: 'hand-authored', reviewState } }))).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['an array', []],
    ['a string', 'hand-authored'],
  ])('rejects provenance that is %s', (_label, provenance) => {
    expect(errs(valid({ provenance }))).toContain('provenance must be an object');
  });

  it('requires a source', () => {
    expect(errs(valid({ provenance: { reviewState: 'draft' } })))
      .toContain('provenance.source must be a non-empty string');
  });

  it('rejects an unknown review state, naming it', () => {
    expect(errs(valid({ provenance: { source: 'hand-authored', reviewState: 'published' } })))
      .toContain('provenance.reviewState must be draft|approved, got: published');
  });
});

describe('program units', () => {
  const programUnit = (over = {}) => ({
    unitId: 'language-daily',
    title: 'Language — today\'s sentences',
    subject: 'language',
    program: 'language',
    cadence: 'daily',
    provenance: { source: 'hand-authored', author: 'parent', reviewState: 'approved' },
    ...over,
  });

  it('accepts a valid daily program unit and normalizes program + cadence', () => {
    const { errors, unit } = validateUnit(programUnit(), refs());
    expect(errors).toEqual([]);
    expect(unit.program).toBe('language');
    expect(unit.cadence).toBe('daily');
  });
  it('defaults cadence to once when omitted', () => {
    const { unit } = validateUnit(programUnit({ cadence: undefined }), refs());
    expect(unit.cadence).toBe('once');
  });
  it('rejects an unknown program id', () => {
    const { errors } = validateUnit(programUnit({ program: 'chess' }), refs());
    expect(errors.some((e) => e.includes("program 'chess' not found"))).toBe(true);
  });
  it('rejects program combined with any other composition', () => {
    for (const extra of [{ bank: 'math-fractions' }, { document: 'math-fractions-01-ws' }, { media: 'liberty-kids-01' }]) {
      const { errors } = validateUnit(programUnit(extra), refs());
      expect(errors.some((e) => e.includes('program is exclusive'))).toBe(true);
    }
  });
  it('rejects passing/retry/review/reward on a program unit', () => {
    for (const extra of [{ passing: { percent: 80 } }, { retry: { variants: 2 } }, { review: 'rubric' }, { reward: { amount: 5 } }]) {
      const { errors } = validateUnit(programUnit(extra), refs());
      expect(errors.length).toBeGreaterThan(0);
    }
  });
  it('rejects courseId/sequence on a program unit', () => {
    const { errors } = validateUnit(programUnit({ courseId: 'c', sequence: 1 }), refs());
    expect(errors.length).toBeGreaterThan(0);
  });
  it('rejects cadence daily on a non-program unit', () => {
    const { errors } = validateUnit(valid({ cadence: 'daily' }), refs());
    expect(errors.some((e) => e.includes('cadence'))).toBe(true);
  });
  it('multi-composition NON-program units stay legal (media + bank)', () => {
    const { errors } = validateUnit(valid({ document: undefined, media: 'liberty-kids-01', bank: 'math-fractions' }), refs());
    expect(errors).toEqual([]);
  });
});

describe('launch units', () => {
  // The one registered adapter used across these tests. `episodeId` is its
  // whole action contract (see `GarageFitnessSurface#validateAction`).
  const surfaceValidators = () => {
    const validators = new Map();
    const surface = new GarageFitnessSurface();
    validators.set('garage-fitness', (payload) => surface.validateAction(payload));
    return validators;
  };
  const refsWithSurfaces = () => ({ ...refs(), surfaceValidators: surfaceValidators() });

  const launchUnit = (over = {}) => ({
    unitId: 'skills-pe-hymn',
    title: 'Play hymn 12 on the piano',
    subject: 'skills',
    launch: { surface: 'garage-fitness', episodeId: 'plex:12345' },
    provenance: { source: 'hand-authored', reviewState: 'approved' },
    ...over,
  });

  it('accepts a legal launch-only unit and normalizes the launch block', () => {
    const { errors, unit } = validateUnit(launchUnit(), refsWithSurfaces());
    expect(errors).toEqual([]);
    expect(unit.launch).toEqual({ surface: 'garage-fitness', episodeId: 'plex:12345' });
  });

  it('omits launch from the normalised unit when absent', () => {
    expect(unitOf(valid())?.launch).toBeUndefined();
  });

  it('joins the "must reference at least one" list — launch alone is enough, no other composition needed', () => {
    const { errors } = validateUnit(launchUnit(), refsWithSurfaces());
    expect(errors).not.toContain('unit must reference at least one of bank, document, media, review');
  });

  it('rejects launch that is not an object', () => {
    expect(errs(launchUnit({ launch: 'garage-fitness' }), refsWithSurfaces()))
      .toContain('launch must be an object');
  });

  it('requires a non-empty surface', () => {
    for (const surface of [undefined, '', '   ', 42]) {
      expect(errs(launchUnit({ launch: { surface, episodeId: 'plex:1' } }), refsWithSurfaces()))
        .toContain('launch.surface must be a non-empty string');
    }
  });

  it('rejects an unknown surface, naming it', () => {
    expect(errs(launchUnit({ launch: { surface: 'sky-castle', episodeId: 'x' } }), refsWithSurfaces()))
      .toContain("launch.surface 'sky-castle' not found");
  });

  it('treats an absent surfaceValidators set as no known surfaces, rather than throwing', () => {
    expect(() => validateUnit(launchUnit(), refs())).not.toThrow();
    expect(errs(launchUnit(), refs())).toContain("launch.surface 'garage-fitness' not found");
  });

  // The adapter is handed the launch block MINUS `surface` — its own action
  // shape, the same payload `DoNowService` will later dispatch with.
  it("rejects a payload the surface adapter's own validateAction rejects", () => {
    expect(errs(launchUnit({ launch: { surface: 'garage-fitness' } }), refsWithSurfaces()))
      .toContain('launch: action.episodeId is required');
  });

  it.each([
    ['media', { media: 'liberty-kids-01' }],
    ['bank', { bank: 'math-fractions' }],
    ['document', { document: 'math-fractions-01-ws' }],
    ['review', { review: 'Parent checks it' }],
    ['program', { program: 'language' }],
  ])('rejects launch combined with %s', (field, extra) => {
    expect(errs(launchUnit(extra), refsWithSurfaces())).toContain(`a launch unit takes no ${field}`);
  });

  it('accepts every other field alongside launch (courseId/sequence/grades/objectives)', () => {
    expect(errs(launchUnit({ courseId: 'skills-1', sequence: 3, grades: ['lower'], objectives: ['Move around'] }), refsWithSurfaces()))
      .toEqual([]);
  });
});

describe('isPublishable', () => {
  it('is true only for an approved unit', () => {
    expect(isPublishable(unitOf(valid({ provenance: { source: 'x', reviewState: 'approved' } })))).toBe(true);
  });

  it('is false for a draft unit', () => {
    expect(isPublishable(unitOf(valid({ provenance: { source: 'x', reviewState: 'draft' } })))).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['provenance-less', {}],
    ['a non-object', 'approved'],
  ])('is false for a %s unit', (_label, unit) => {
    expect(isPublishable(unit)).toBe(false);
  });
});
