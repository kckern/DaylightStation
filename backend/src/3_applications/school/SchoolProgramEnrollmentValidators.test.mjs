import { describe, expect, it, vi } from 'vitest';
import { createSchoolProgramEnrollmentValidators } from './SchoolProgramEnrollmentValidators.mjs';
import { SetAssignments } from './usecases/SetAssignments.mjs';

const validators = () => createSchoolProgramEnrollmentValidators({
  pianoCourseLauncher: {},
});

describe('School program enrollment schedules', () => {
  it('normalizes a weekday schedule for every program enrollment', async () => {
    const story = await validators().get('story-time')({
      programId: 'story-time', target: 2, schedule: { daysOfWeek: [5, 1, 3, 1, 2, 4] },
    });
    const piano = await validators().get('piano-course')({
      programId: 'piano-course', courseId: 'plex:123', schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    });

    expect(story).toMatchObject({ errors: [], enrollment: { schedule: { daysOfWeek: [1, 2, 3, 4, 5] } } });
    expect(piano).toMatchObject({ errors: [], enrollment: { schedule: { daysOfWeek: [1, 2, 3, 4, 5] } } });
  });

  it('refuses a malformed program schedule instead of silently dropping it', async () => {
    const result = await validators().get('story-time')({
      programId: 'story-time', schedule: { daysOfWeek: [0] },
    });

    expect(result.errors[0]).toMatch(/^schedule\.daysOfWeek/);
    expect(result.enrollment).toBeUndefined();
  });

  it('keeps elective: true on any program, drops elective: false, refuses a non-boolean', async () => {
    const optional = await validators().get('story-time')({ programId: 'story-time', elective: true });
    const required = await validators().get('story-time')({ programId: 'story-time', elective: false });
    const bad = await validators().get('story-time')({ programId: 'story-time', elective: 'yes' });
    expect(optional).toMatchObject({ errors: [], enrollment: { elective: true } });
    expect(required.enrollment).not.toHaveProperty('elective');
    expect(bad.errors).toEqual(['elective must be true or false']);
  });
});

describe('Piano course daily video cap', () => {
  it('preserves a positive whole cap through normalization with the schedule', async () => {
    const result = await validators().get('piano-course')({
      programId: 'piano-course', courseId: 'plex:123', videosLockedAfter: 2,
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    });

    expect(result).toEqual({ errors: [], enrollment: {
      programId: 'piano-course', corpusId: 'plex:123', courseId: 'plex:123', subject: 'arts',
      videosLockedAfter: 2, schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    } });
  });

  it.each([undefined, 0, -1, 1.5, '2'])(
    'keeps an absent or invalid cap (%s) out of the normalized enrollment',
    async (videosLockedAfter) => {
      const result = await validators().get('piano-course')({
        programId: 'piano-course', courseId: 'plex:123', videosLockedAfter,
      });

      expect(result.errors).toEqual([]);
      expect(result.enrollment).not.toHaveProperty('videosLockedAfter');
    },
  );

  it('writes the normalized cap through SetAssignments', async () => {
    const assignments = { put: vi.fn(async (record) => record) };
    const useCase = new SetAssignments({
      assignments,
      grownUps: { assert: vi.fn() },
      programValidators: validators(),
      clock: () => new Date('2026-09-03T12:00:00.000Z'),
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    await useCase.execute({
      learnerId: 'learner-1', assignedBy: 'parent',
      programs: [{ programId: 'piano-course', courseId: 'plex:123', videosLockedAfter: 2 }],
    });

    expect(assignments.put).toHaveBeenCalledWith(expect.objectContaining({
      programs: [expect.objectContaining({
        programId: 'piano-course', courseId: 'plex:123', videosLockedAfter: 2,
      })],
    }));
  });
});
