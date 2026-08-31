import { describe, expect, it } from 'vitest';
import { createSchoolProgramEnrollmentValidators } from './SchoolProgramEnrollmentValidators.mjs';

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
});
