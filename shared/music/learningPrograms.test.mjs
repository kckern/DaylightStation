import { describe, expect, it } from 'vitest';
import { attemptSatisfies, buildLearningSummary, projectProgram } from './learningPrograms.mjs';

const requirement = {
  exercise_id: 'drills/hanon/001@root=C,direction=up-then-down,span_octaves=2',
  mode: 'cued', rubric: { id: 'r1', criteria: { completeness: 1, cleanliness: 1, placement: 0.8 } },
  gates: { pace: { target_bpm: 60 } }, required_passes: 1,
};
const pass = {
  status: 'completed', purpose: 'challenge', challenge_id: 'c1',
  prompt: { exercise_id: requirement.exercise_id },
  criteria: { completeness: 1, cleanliness: 1, placement: 0.9 },
  diagnostics: { achieved_bpm: 60 }, score: 0.97, verdict: { passed: true },
};
const program = { id: 'hanon', title: 'Hanon', steps: [
  { id: 'one', requirement, mastery_bpm: [72, 108] },
  { id: 'two', requirement: { ...requirement, exercise_id: requirement.exercise_id.replace('001', '002') }, mastery_bpm: [72, 108] },
] };

describe('learning program projection', () => {
  it('requires canonical criterion evidence and a pace gate', () => {
    expect(attemptSatisfies(pass, requirement)).toBe(true);
    expect(attemptSatisfies({ ...pass, purpose: 'practice' }, requirement)).toBe(false);
    expect(attemptSatisfies({ ...pass, criteria: { completeness: 1, cleanliness: 1 } }, requirement)).toBe(false);
    expect(attemptSatisfies({ ...pass, diagnostics: { achieved_bpm: 59 } }, requirement)).toBe(false);
  });

  it('opens exactly the first unpassed ordered step', () => {
    const projected = projectProgram(program, [pass]);
    expect(projected.steps.map((step) => step.state)).toEqual(['passed', 'current']);
    expect(projected.percent).toBe(50);
  });

  it('selects assigned work before optional enrolled work', () => {
    const other = { ...program, id: 'other', title: 'Other' };
    const summary = buildLearningSummary({
      programs: [program, other], attempts: [], enrollments: ['other'], assignment: { programs: ['hanon'] },
    });
    expect(summary.next_up.program_id).toBe('hanon');
    expect(summary.programs.find((entry) => entry.id === 'hanon').required).toBe(true);
  });
});
