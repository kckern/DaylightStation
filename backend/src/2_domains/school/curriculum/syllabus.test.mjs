import { describe, expect, it } from 'vitest';
import { validateSyllabus } from './syllabus.mjs';

const VALID = {
  schema: 'school.syllabus/v1',
  syllabusId: 'elements-lower',
  title: 'The Elements — lower',
  courseId: 'the-elements-ted-gray',
  profile: 'lower',
  policy: { lesson_order: 'sequence' },
  passing: 60,
  term: '2026-fall',
};
const SETS = { courseIds: new Set(['the-elements-ted-gray']), profileIds: new Set(['lower', 'upper']) };

describe('validateSyllabus', () => {
  it('accepts a full record and normalizes it', () => {
    const { errors, syllabus } = validateSyllabus(VALID, SETS);
    expect(errors).toEqual([]);
    expect(syllabus).toEqual(VALID);
  });

  it('accepts a minimal record, nulling the optional fields', () => {
    const { errors, syllabus } = validateSyllabus({
      schema: 'school.syllabus/v1', syllabusId: 'elements-full',
      title: 'The Elements', courseId: 'the-elements-ted-gray',
    }, SETS);
    expect(errors).toEqual([]);
    expect(syllabus.profile).toBeNull();
    expect(syllabus.policy).toBeNull();
    expect(syllabus.passing).toBeNull();
    expect(syllabus.term).toBeNull();
  });

  it('requires the schema discriminator', () => {
    const { errors } = validateSyllabus({ ...VALID, schema: 'school.syllabus/v2' }, SETS);
    expect(errors).toContain('schema must be school.syllabus/v1');
  });

  it('refuses a syllabusId that is not a slug', () => {
    expect(validateSyllabus({ ...VALID, syllabusId: '../escape' }, SETS).errors)
      .toContain('syllabusId must match ^[a-z0-9][a-z0-9-]*$, got: ../escape');
  });

  it('names an unknown course rather than accepting a ghost', () => {
    expect(validateSyllabus({ ...VALID, courseId: 'nope' }, SETS).errors)
      .toContain("unknown course: 'nope' is not in the published catalog");
  });

  it('names an unknown profile', () => {
    expect(validateSyllabus({ ...VALID, profile: 'middle' }, SETS).errors)
      .toContain("unknown profile: 'middle' is not offered by the-elements-ted-gray");
  });

  it('refuses a passing bar outside 1..100', () => {
    expect(validateSyllabus({ ...VALID, passing: 0 }, SETS).errors)
      .toContain('passing must be an integer between 1 and 100');
    expect(validateSyllabus({ ...VALID, passing: 101 }, SETS).errors)
      .toContain('passing must be an integer between 1 and 100');
  });

  it('refuses module subsetting — wave 1 is whole-course only', () => {
    expect(validateSyllabus({ ...VALID, modules: ['period-1'] }, SETS).errors)
      .toContain('modules is not supported yet — a syllabus covers its whole course');
  });

  it('refuses unknown policy keys and bad ordering values', () => {
    expect(validateSyllabus({ ...VALID, policy: { lesson_order: 'random' } }, SETS).errors)
      .toContain('policy.lesson_order must be sequence|shuffle_once, got: random');
    expect(validateSyllabus({ ...VALID, policy: { nope: 1 } }, SETS).errors)
      .toContain('policy has unknown keys: nope');
  });

  it('degrades to accepting when reference sets are unavailable', () => {
    const { errors } = validateSyllabus({ ...VALID, courseId: 'anything' }, {});
    expect(errors).toEqual([]);
  });
});
