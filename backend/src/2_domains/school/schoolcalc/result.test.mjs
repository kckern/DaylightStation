import { describe, expect, it } from 'vitest';
import {
  classifySchoolCalcResultClaim,
  schoolCalcResultIdentity,
  validateSchoolCalcSubmission,
  verifySchoolCalcLocalScore,
} from './result.mjs';

const responseSubmission = {
  schema: 'school.calc.submission/v1', kind: 'responses',
  deviceId: '86A001', sequence: 17, learnerKey: 4, artifactId: 'sc:ti86:ABC234DEFG',
  lessonId: 'compound-growth', moduleId: 'check',
  responses: [{ itemId: 'q1', given: 'Principal plus interest' }],
  localScore: { correct: 1, total: 1, percent: 100, basis: 'embedded_answer_key' },
};

describe('SchoolCalc result domain rules', () => {
  it('accepts a locally computed score as evidence but refuses authority claims', () => {
    expect(validateSchoolCalcSubmission(responseSubmission)).toMatchObject({ errors: [] });
    const invalid = { ...responseSubmission, score: 1, learnerId: 'child-a' };
    expect(validateSchoolCalcSubmission(invalid).errors).toEqual(expect.arrayContaining([
      'learnerId is server-authoritative and must not be submitted',
      'score is server-authoritative and must not be submitted',
    ]));

    const falseClock = { ...responseSubmission, occurredAt: '2020-01-01T00:00:00.000Z' };
    expect(validateSchoolCalcSubmission(falseClock).errors).toContain(
      'occurredAt is not accepted as authoritative calculator time',
    );
  });

  it('validates probe attempt history without replacing the score-bearing first response', () => {
    const probe = structuredClone(responseSubmission);
    probe.responses[0].probe = {
      attempts: ['Principal plus interest', 'Principal'],
      feedbackViewed: true,
      continued: true,
    };
    expect(validateSchoolCalcSubmission(probe).errors).toEqual([]);
    probe.responses[0].probe.attempts[0] = 'Principal';
    expect(validateSchoolCalcSubmission(probe).errors).toContain(
      'responses[0].probe.attempts[0] must equal the score-bearing given response',
    );
  });

  it('verifies local score evidence against the immutable answer key', () => {
    const bank = {
      id: 'check', title: 'Check', audience: 'assigned',
      items: [{
        id: 'q1', type: 'multiple_choice', prompt: 'Pick two',
        choices: ['One', 'Two'], answer: 'Two',
      }],
    };
    expect(verifySchoolCalcLocalScore({
      localScore: responseSubmission.localScore,
      responses: [{ itemId: 'q1', given: 'Two' }],
      bank,
    })).toMatchObject({
      errors: [],
      score: { correct: 1, total: 1, percent: 100, verified: true },
    });
    expect(verifySchoolCalcLocalScore({
      localScore: { correct: 0, total: 1, percent: 0, basis: 'embedded_answer_key' },
      responses: [{ itemId: 'q1', given: 'Two' }],
      bank,
    }).errors[0]).toMatch(/does not match/);
  });

  it('validates progress through the same submission contract', () => {
    expect(validateSchoolCalcSubmission({
      schema: 'school.calc.submission/v1', kind: 'progress',
      deviceId: '86A001', sequence: 18, learnerKey: 4, artifactId: 'sc:ti86:ABC234DEFG',
      lessonId: 'compound-growth', moduleId: 'notes',
      progress: { status: 'viewed', position: 4, total: 9 },
    }).errors).toEqual([]);
  });

  it('classifies new, duplicate, conflict, and interrupted-resume claims', () => {
    expect(classifySchoolCalcResultClaim({ incomingDigest: 'a' })).toBe('new');
    expect(classifySchoolCalcResultClaim({ existingDigest: 'a', incomingDigest: 'a' })).toBe('resume');
    expect(classifySchoolCalcResultClaim({ existingDigest: 'a', incomingDigest: 'a', importComplete: true })).toBe('duplicate');
    expect(classifySchoolCalcResultClaim({ existingDigest: 'a', incomingDigest: 'b', importComplete: true })).toBe('conflict');
    expect(schoolCalcResultIdentity(responseSubmission)).toBe('86A001:17');
  });
});
