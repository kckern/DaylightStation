import { describe, expect, it, vi } from 'vitest';
import { SetAssignments } from './SetAssignments.mjs';
import { createSchoolProgramEnrollmentValidators } from '../SchoolProgramEnrollmentValidators.mjs';

function harness() {
  const assignments = {
    get: vi.fn(async () => null),
    put: vi.fn(async (record) => record),
  };
  const useCase = new SetAssignments({
    assignments,
    grownUps: { assert: vi.fn() },
    programValidators: createSchoolProgramEnrollmentValidators({}),
    clock: () => new Date('2026-09-03T12:00:00.000Z'),
    logger: { info: vi.fn(), warn: vi.fn() },
  });
  return { assignments, useCase };
}

describe('SetAssignments reading-program family', () => {
  it('refuses the preschool and independent-reading experiences together', async () => {
    const { assignments, useCase } = harness();

    await expect(useCase.execute({
      learnerId: 'user_4',
      assignedBy: 'parent',
      programs: [
        { programId: 'story-time', target: 2, subject: 'english' },
        {
          programId: 'book-log', subject: 'english',
          obligation: { metric: 'checkins', quantity: 1, per: 'day' },
        },
      ],
    })).rejects.toThrow('choose one reading experience');

    expect(assignments.put).not.toHaveBeenCalled();
  });

  it('accepts User_4’s independent-reading assignment as the sole reading experience', async () => {
    const { assignments, useCase } = harness();

    await useCase.execute({
      learnerId: 'user_4',
      assignedBy: 'parent',
      programs: [{
        programId: 'book-log', subject: 'english', title: 'Reading',
        obligation: { metric: 'checkins', quantity: 1, per: 'day' },
        schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
      }],
    });

    expect(assignments.put).toHaveBeenCalledWith(expect.objectContaining({
      learnerId: 'user_4',
      programs: [{
        programId: 'book-log', corpusId: null, subject: 'english', title: 'Reading',
        obligation: { metric: 'checkins', quantity: 1, per: 'day', scope: null },
        schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
      }],
    }));
  });
});
