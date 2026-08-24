import { describe, it, expect } from 'vitest';
import { GetTeacherToday } from './GetTeacherToday.mjs';

const events = [
  { type: 'created', at: '2026-08-23T15:00:00.000Z', sessionId: 'ses_felix', seq: 1,
    learnerId: 'felix', unitId: 'lesson-1', studyDay: '2026-08-23' },
  { type: 'issued', at: '2026-08-23T15:01:00.000Z', sessionId: 'ses_felix', seq: 2, artifactId: 'art_1' },
  { type: 'submitted', at: '2026-08-24T16:00:00.000Z', sessionId: 'ses_felix', seq: 3, transport: 'paper' },
  { type: 'graded', at: '2026-08-24T16:01:00.000Z', sessionId: 'ses_felix', seq: 4,
    attemptIds: ['att_1', 'att_2'], percent: 50, passingPercent: 80, correctCount: 1, totalCount: 2 },
];

function useCase() {
  return new GetTeacherToday({
    learnerDirectory: { listLearners: async () => [{ id: 'felix', name: 'Felix' }] },
    datastore: { readAttemptDay: () => [] },
    sessions: {
      listForLearner: async () => [{ sessionId: 'ses_felix', updatedAt: events.at(-1).at }],
      readEvents: async () => events,
    },
    curriculum: {
      listUnits: async () => [{ unitId: 'lesson-1', title: 'Lesson One', subject: 'math', courseId: 'course-1', module: 'unit-a' }],
      listWorks: async () => [{ work: 'course-1', title: 'Course One', subject: 'math' }],
    },
    timezone: 'UTC', boundaryHour: 4,
    clock: () => new Date('2026-08-24T18:00:00.000Z'), logger: { debug() {} },
  });
}

describe('GetTeacherToday v2', () => {
  it('keeps Felix work on August 23 and reports its August 24 scan once as processed today', async () => {
    const august23 = await useCase().execute({ studyDay: '2026-08-23', version: 'v2' });
    expect(august23.learners[0]).toMatchObject({
      effectiveScoreTotals: { correct: 1, total: 2, percent: 50 },
      sessions: [{ sessionId: 'ses_felix', studyDay: '2026-08-23' }],
      processedToday: [],
    });

    const august24 = await useCase().execute({ studyDay: '2026-08-24', version: 'v2' });
    expect(august24.learners[0].sessions).toEqual([]);
    expect(august24.learners[0].effectiveScoreTotals).toEqual({ correct: 0, total: 0, percent: null });
    expect(august24.learners[0].processedToday).toHaveLength(1);
    expect(august24.learners[0].processedToday[0]).toMatchObject({
      sessionId: 'ses_felix', studyDay: '2026-08-23', processedAt: '2026-08-24T16:01:00.000Z',
      processedEventTypes: ['submitted', 'graded'],
    });
  });
});
