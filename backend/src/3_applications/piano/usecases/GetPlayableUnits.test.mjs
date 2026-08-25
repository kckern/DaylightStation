import { describe, it, expect, vi } from 'vitest';
import { GetPlayableUnits } from './GetPlayableUnits.mjs';

const COURSE = '12345';
const COMPOUND = `plex:${COURSE}`;
const AHEAD = 'felix';
const BEHIND = 'milo';

/** Six lessons in one unit — plex 100..105, itemIndex 1..6. */
const lessons = () => Array.from({ length: 6 }, (_, i) => ({
  plex: String(100 + i),
  title: `Lesson ${i + 1}`,
  itemIndex: i + 1,
  parentId: '10',
  parentIndex: 1,
}));

const playableService = () => ({
  getPlayableEpisodes: vi.fn().mockResolvedValue({
    compoundId: COMPOUND,
    showId: COURSE,
    items: lessons(),
    parents: { 10: { index: 1, title: 'Unit 1' } },
    info: { title: 'Hoffman Academy', labels: ['sequential'], type: 'show' },
  }),
});

/**
 * @param watched  map of userId -> plex ids credited as watched
 * @param completedAt map of plex id -> ISO completion stamp (for the ahead user)
 */
const progressStore = (watched, completedAt = {}) => ({
  isKnownUser: (id) => Object.prototype.hasOwnProperty.call(watched, id),
  enrich: (items, userId) => items.map((it) => ({
    ...it,
    userWatched: (watched[userId] || []).includes(it.plex),
    userCompletedAt: userId === AHEAD ? (completedAt[it.plex] ?? null) : null,
  })),
});

const configService = ({ coProgress = true } = {}) => ({
  getUserProfile: (id) => ({ id }),
  getTimezone: () => 'America/Los_Angeles',
  getHouseholdAppConfig: () => ({
    videos: {
      sequential_labels: ['sequential'],
      ...(coProgress
        ? { co_progress: [{ courseId: COMPOUND, users: [AHEAD, BEHIND], buffer: 5 }] }
        : {}),
    },
  }),
});

/** School says this learner is enrolled in the piano-course program for `courseId`. */
const assignmentStore = (programs) => ({ get: vi.fn().mockResolvedValue({ learnerId: AHEAD, programs }) });

const NOON = Date.parse('2026-08-25T19:00:00Z'); // 12:00 PDT, inside the 4am study day

const build = ({ watched, completedAt, programs = null, coProgress = true, logger } = {}) => new GetPlayableUnits({
  fitnessPlayableService: playableService(),
  userVideoProgressStore: progressStore(watched, completedAt),
  configService: configService({ coProgress }),
  schoolAssignments: programs ? assignmentStore(programs) : null,
  clock: () => new Date(NOON),
  logger: logger ?? { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

// The ahead learner has done 5 lessons, the partner none — exactly the buffer.
const AHEAD_BY_BUFFER = { [AHEAD]: ['100', '101', '102', '103', '104'], [BEHIND]: [] };

const PIANO_PROGRAM = [{ programId: 'piano-course', courseId: COMPOUND }];

describe("GetPlayableUnits — today's assigned lesson overrides the co-progress lock", () => {
  it('still locks an ahead learner whose next lesson is NOT assigned school work', async () => {
    const outcome = await build({ watched: AHEAD_BY_BUFFER }).execute({ courseId: COURSE, userId: AHEAD });

    expect(outcome.ok).toBe(true);
    expect(outcome.result.coProgressLock).toEqual({
      locked: true,
      aheadBy: 5,
      waitingForId: BEHIND,
      buffer: 5,
    });
    expect(outcome.result.coProgressLock.exemptLessonIds).toBeUndefined();
  });

  it('still locks when School assigned a DIFFERENT course', async () => {
    const outcome = await build({
      watched: AHEAD_BY_BUFFER,
      programs: [{ programId: 'piano-course', courseId: 'plex:99999' }],
    }).execute({ courseId: COURSE, userId: AHEAD });

    expect(outcome.result.coProgressLock.locked).toBe(true);
    expect(outcome.result.coProgressLock.exemptLessonIds).toBeUndefined();
  });

  it("exempts today's assigned lesson so the learner can finish their day", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const outcome = await build({ watched: AHEAD_BY_BUFFER, programs: PIANO_PROGRAM, logger })
      .execute({ courseId: COURSE, userId: AHEAD });

    // The pacing state is still true — the child IS ahead — but the one lesson
    // the household assigned is not gated by it.
    expect(outcome.result.coProgressLock.locked).toBe(true);
    expect(outcome.result.coProgressLock.exemptLessonIds).toEqual(['105']);
    expect(logger.info).toHaveBeenCalledWith(
      'piano.co-progress.assigned-override',
      expect.objectContaining({ userId: AHEAD, courseId: COMPOUND, lessonId: '105' }),
    );
  });

  it('exempts ONLY the assigned lesson, never the rest of the course', async () => {
    const outcome = await build({
      watched: { [AHEAD]: ['100', '101'], [BEHIND]: [] },
      programs: PIANO_PROGRAM,
    }).execute({ courseId: COURSE, userId: AHEAD });

    // Ahead by 2 < buffer 5: no lock at all, so nothing to exempt.
    expect(outcome.result.coProgressLock).toBeNull();

    // And when the lock DOES apply, exactly one lesson is exempt — the next
    // one — leaving 103/104/105 paced as before.
    const locked = await build({
      watched: { [AHEAD]: ['100', '101', '102', '103', '104'], [BEHIND]: [] },
      programs: PIANO_PROGRAM,
    }).execute({ courseId: COURSE, userId: AHEAD });
    expect(locked.result.coProgressLock.exemptLessonIds).toHaveLength(1);
  });

  it('withdraws the exemption once the assigned lesson has been done today', async () => {
    const outcome = await build({
      watched: { [AHEAD]: ['100', '101', '102', '103', '104', '105'], [BEHIND]: [] },
      completedAt: { 105: '2026-08-25T18:00:00Z' }, // 11:00 PDT — same study day
      programs: PIANO_PROGRAM,
    }).execute({ courseId: COURSE, userId: AHEAD });

    // Today's obligation is discharged; discretionary practice is paced again.
    expect(outcome.result.coProgressLock.locked).toBe(true);
    expect(outcome.result.coProgressLock.exemptLessonIds).toBeUndefined();
  });

  it('re-grants the exemption on a new study day', async () => {
    const outcome = await build({
      watched: { [AHEAD]: ['100', '101', '102', '103', '104', '105'], [BEHIND]: [] },
      completedAt: { 105: '2026-08-24T18:00:00Z' }, // yesterday
      programs: PIANO_PROGRAM,
    }).execute({ courseId: COURSE, userId: AHEAD });

    // Every lesson is watched, so there is no next lesson to exempt, but the
    // yesterday-completion must not be mistaken for today's.
    expect(outcome.result.coProgressLock.locked).toBe(true);
    expect(outcome.result.coProgressLock.exemptLessonIds).toBeUndefined();
  });

  it('leaves a learner under no co-progress rule completely unaffected', async () => {
    const outcome = await build({ watched: AHEAD_BY_BUFFER, programs: PIANO_PROGRAM, coProgress: false })
      .execute({ courseId: COURSE, userId: AHEAD });

    expect(outcome.result.coProgressLock).toBeNull();
  });

  it('never consults School for a course with no lock in force', async () => {
    const assignments = assignmentStore(PIANO_PROGRAM);
    const useCase = new GetPlayableUnits({
      fitnessPlayableService: playableService(),
      userVideoProgressStore: progressStore({ [AHEAD]: ['100'], [BEHIND]: [] }),
      configService: configService(),
      schoolAssignments: assignments,
      clock: () => new Date(NOON),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    await useCase.execute({ courseId: COURSE, userId: AHEAD });
    expect(assignments.get).not.toHaveBeenCalled();
  });

  it('keeps the lock when the assignment store is unreachable', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const useCase = new GetPlayableUnits({
      fitnessPlayableService: playableService(),
      userVideoProgressStore: progressStore(AHEAD_BY_BUFFER),
      configService: configService(),
      schoolAssignments: { get: vi.fn().mockRejectedValue(new Error('yaml is corrupt')) },
      clock: () => new Date(NOON),
      logger,
    });
    const outcome = await useCase.execute({ courseId: COURSE, userId: AHEAD });

    expect(outcome.result.coProgressLock.locked).toBe(true);
    expect(outcome.result.coProgressLock.exemptLessonIds).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'piano.co-progress.assignment-lookup-failed',
      expect.objectContaining({ userId: AHEAD }),
    );
  });
});
