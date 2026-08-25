import { describe, expect, it } from 'vitest';
import { evaluateSchoolFitnessAttempt } from '#domains/fitness/schoolCourseAssessment.mjs';
import { defaultFitnessSuccessPolicy } from '#domains/school/fitnessCourse.mjs';

describe('Fitness assessment for School attempts', () => {
  it('passes the minimal policy only when video and trustworthy HR coverage both pass', () => {
    const passing = evaluateSchoolFitnessAttempt({
      policy: defaultFitnessSuccessPolicy(),
      observations: { media: { completion_ratio: 0.9 }, heart_rate: { coverage_ratio: 0.8 } },
    });
    expect(passing.result).toBe('passed');
    expect(passing.criteria.every((criterion) => criterion.pass)).toBe(true);
  });

  it('treats missing required sensor evidence as remediation with diagnostics', () => {
    const result = evaluateSchoolFitnessAttempt({
      policy: defaultFitnessSuccessPolicy(),
      observations: { media: { completion_ratio: 1 }, heart_rate: {} },
    });
    expect(result.result).toBe('needs_remediation');
    expect(result.criteria).toContainEqual(expect.objectContaining({
      metric: 'heart_rate.coverage_ratio', observed: null, pass: false,
    }));
  });

  it('supports nested all/any/atLeast boolean gates without inventing a weighted score', () => {
    const policy = {
      all: [
        { metric: 'media.completion_ratio', op: 'gte', value: 0.5 },
        { atLeast: { count: 2, of: [
          { metric: 'cadence.average_rpm', op: 'gte', value: 70 },
          { metric: 'heart_rate.average_bpm', op: 'gte', value: 120 },
          { metric: 'voice_memo.count', op: 'gte', value: 1 },
        ] } },
      ],
    };
    const result = evaluateSchoolFitnessAttempt({
      policy,
      observations: {
        media: { completion_ratio: 0.75 }, cadence: { average_rpm: 72 },
        heart_rate: { average_bpm: 100 }, voice_memo: { count: 1 },
      },
    });
    expect(result).toMatchObject({ passed: true, result: 'passed' });
    expect(result.score).toBeUndefined();
  });

  it('evaluates voice reflection only by attributed presence/duration', () => {
    const result = evaluateSchoolFitnessAttempt({
      policy: { all: [
        { metric: 'voice_memo.count', op: 'gte', value: 1 },
        { metric: 'voice_memo.duration_seconds', op: 'gte', value: 10 },
      ] },
      observations: { voice_memo: { count: 1, duration_seconds: 12 } },
    });
    expect(result.result).toBe('passed');
    expect(JSON.stringify(result)).not.toMatch(/transcript|semantic|sentiment/i);
  });
});
