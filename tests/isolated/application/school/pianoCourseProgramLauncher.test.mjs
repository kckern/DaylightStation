/**
 * The daily piano requirement's completion rule, which is the whole reason
 * this launcher exists rather than a config-driven `SurfaceProgramLauncher`:
 * the day is discharged by EVIDENCE (a lesson stamped complete inside today's
 * study day), not by a dispatch.
 *
 * The study-day boundary cases are the ones worth pinning: a lesson finished
 * at 11pm and a lesson finished at 1am the next morning are the SAME school
 * day (4am→4am), and a lesson finished at 5am is a new one. Getting that
 * wrong either double-charges a child or silently forgives a missed day.
 */
import { describe, it, expect } from 'vitest';
import { PianoCourseProgramLauncher } from '#apps/school/PianoCourseProgramLauncher.mjs';

const COURSE = 'plex:675689';
const TZ = 'America/Los_Angeles';

/** A fake `GetPlayableUnits` returning a fixed projection. */
const fakeUnits = (result, { ok = true, reason = null } = {}) => ({
  execute: async () => (ok ? { ok: true, result } : { ok: false, reason }),
});

const lesson = (id, { completedAt = null, watched = false, isReference = false, title = id } = {}) => ({
  id, title, isReference, userWatched: watched || !!completedAt, userCompletedAt: completedAt,
});

const launcherFor = (result, nowIso, opts) => new PianoCourseProgramLauncher({
  getPlayableUnits: fakeUnits(result, opts),
  timezone: TZ,
  clock: () => new Date(nowIso),
  logger: { warn() {}, info() {} },
});

describe('PianoCourseProgramLauncher.status', () => {
  it('is done when a lesson completed earlier in the same study day', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z', title: 'Unit 3 Lesson 7' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
    expect(status.progressLabel).toContain('Unit 3 Lesson 7');
  });

  it('is NOT done when the only completion was the previous study day', async () => {
    // 2026-08-24 18:00Z is 11:00 PDT on the 24th; "now" is 11:00 PDT on the
    // 25th. Two different study days, one calendar day apart.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-24T18:00:00Z' })] },
      '2026-08-25T18:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
  });

  it('treats a late-night finish and the small hours after it as ONE study day', async () => {
    // 2026-08-26T06:30Z = 23:30 PDT on the 25th. "Now" is 2026-08-26T10:00Z
    // = 03:00 PDT on the 26th — before the 4am boundary, so still the 25th.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-26T06:30:00Z' })] },
      '2026-08-26T10:00:00Z',
    );
    expect((await launcher.status({ userId: 'learner4', programInstance: COURSE })).doneToday).toBe(true);
  });

  it('rolls over at 4am: the same completion no longer counts after the boundary', async () => {
    // Same completion as above, but "now" is 2026-08-26T12:30Z = 05:30 PDT,
    // past the boundary — a new school day that has had no lesson yet.
    const launcher = launcherFor(
      { items: [lesson('a', { completedAt: '2026-08-26T06:30:00Z' })] },
      '2026-08-26T12:30:00Z',
    );
    expect((await launcher.status({ userId: 'learner4', programInstance: COURSE })).doneToday).toBe(false);
  });

  it('does not let a reference/practice unit discharge the day', async () => {
    // Reference units give no credit in the kiosk's own progression, so they
    // must not discharge the obligation either — otherwise a child "finishes"
    // school by replaying a warm-up they are never locked out of.
    const launcher = launcherFor(
      { items: [lesson('warmup', { completedAt: '2026-08-25T18:00:00Z', isReference: true })] },
      '2026-08-25T20:00:00Z',
    );
    expect((await launcher.status({ userId: 'learner4', programInstance: COURSE })).doneToday).toBe(false);
  });

  it('excuses a co-progress lockout rather than leaving an impossible debt', async () => {
    const launcher = launcherFor(
      {
        items: [lesson('a', { watched: true }), lesson('b')],
        coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3 },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBe(true);
    expect(status.progressLabel).toContain('learner3');
  });

  it('reports a real completion as done, not excused, even while locked', async () => {
    // The child finished today AND is now blocked from the next one. That is
    // a discharged requirement, and the ceremony must be allowed to fire.
    const launcher = launcherFor(
      {
        items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z' })],
        coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3 },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
  });

  it('names the next lesson when the day is still owed', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true }), lesson('b', { title: 'Unit 4 Lesson 1' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
    expect(status.progressLabel).toContain('next: Unit 4 Lesson 1');
    expect(status.score).toBe(50);
  });

  it('owes the day when the lock exempts today\'s assigned lesson', async () => {
    // The pacing rule still says this child is ahead, but School assigned them
    // this lesson — so it is work they can and must do, not an excused day.
    const launcher = launcherFor(
      {
        items: [lesson('a', { watched: true }), lesson('b', { title: 'Unit 4 Lesson 1' })],
        coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3, exemptLessonIds: ['b'] },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
    expect(status.excused).toBeUndefined();
    expect(status.progressLabel).toContain('next: Unit 4 Lesson 1');
  });

  it('still excuses a lockout that exempts some OTHER lesson', async () => {
    const launcher = launcherFor(
      {
        items: [lesson('a', { watched: true }), lesson('b')],
        coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3, exemptLessonIds: ['zzz'] },
      },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.excused).toBe(true);
  });

  it('reports error (never a silent "done") when the course cannot be read', async () => {
    const launcher = launcherFor({}, '2026-08-25T20:00:00Z', { ok: false, reason: 'invalid_user' });
    expect(await launcher.status({ userId: 'nobody', programInstance: COURSE })).toEqual({ error: true });
  });

  it('reports error when the use case throws outright', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async () => { throw new Error('plex down'); } },
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {} },
    });
    expect(await launcher.status({ userId: 'learner4', programInstance: COURSE })).toEqual({ error: true });
  });

  it('is not done, and does not throw, with no course assigned', async () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    const status = await launcher.status({ userId: 'learner4', programInstance: null });
    expect(status.doneToday).toBe(false);
  });
});

describe('PianoCourseProgramLauncher.status — nextLesson', () => {
  it('names the next unwatched lesson when owed', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true, title: 'Lesson 1' }), lesson('b', { title: 'Lesson 2' })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false);
    expect(status.nextLesson?.lesson?.id).toContain('b');
  });

  it('is null when the course is fully watched (nothing left to gate on)', async () => {
    const launcher = launcherFor(
      { items: [lesson('a', { watched: true })] },
      '2026-08-25T20:00:00Z',
    );
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(false); // no completion TODAY, but nothing left to launch
    expect(status.nextLesson).toBeNull();
  });
});

describe('PianoCourseProgramLauncher.status — parent bypass', () => {
  const bypassStore = (record) => ({ activeFor: async () => record });

  it('an active bypass settles the day as excused/bypassed, not owed', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a')] }),
      dayBypasses: bypassStore({ decidedBy: 'kckern', reason: 'Recital' }),
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBe(true);
    expect(status.bypassed).toBe(true);
    expect(status.progressLabel).toContain('Excused today by kckern');
  });

  it('a real completion outranks an active bypass — no excused flag, ceremony-eligible', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a', { completedAt: '2026-08-25T18:00:00Z' })] }),
      dayBypasses: bypassStore({ decidedBy: 'kckern', reason: 'Recital' }),
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.doneToday).toBe(true);
    expect(status.excused).toBeUndefined();
    expect(status.bypassed).toBeUndefined();
  });

  it('a bypass store throw is treated as no bypass, never error:true', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({ items: [lesson('a')] }),
      dayBypasses: { activeFor: async () => { throw new Error('disk gone'); } },
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.error).toBeUndefined();
    expect(status.doneToday).toBe(false);
  });

  it('no dayBypasses dependency behaves exactly as before (opt-in)', async () => {
    const launcher = launcherFor({ items: [lesson('a')] }, '2026-08-25T20:00:00Z');
    const status = await launcher.status({ userId: 'learner4', programInstance: COURSE });
    expect(status.bypassed).toBeUndefined();
  });
});

describe('PianoCourseProgramLauncher launch contract', () => {
  it('declares itself mountable so the agenda mints a QR and panel code', () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    expect(launcher.mountable).toBe(true);
    expect(launcher.surface).toBe('piano-kiosk');
    expect(launcher.locationHint).toBe('at the piano');
  });

  it('fails in words when DoNow is not wired', async () => {
    const launcher = launcherFor({ items: [] }, '2026-08-25T20:00:00Z');
    const result = await launcher.launch({ userId: 'learner4' });
    expect(result.decision).toBe('failed');
    expect(result.message).toMatch(/piano/i);
  });

  it('maps the exact next Plex season and episode into a kiosk launch target', async () => {
    const launcher = launcherFor({
      compoundId: COURSE,
      info: { title: 'Hoffman Academy' },
      parents: { 'season-4': { title: 'Unit 4', index: 4 } },
      items: [{
        id: 'plex:9001', title: 'Lesson 1', parentId: 'season-4',
        parentTitle: 'Unit 4', parentIndex: 4, itemIndex: 1,
        userWatched: false, isReference: false,
      }],
    }, '2026-08-25T20:00:00Z');
    await expect(launcher.issueLaunchTarget({ userId: 'learner4', programInstance: COURSE }))
      .resolves.toEqual({
        kind: 'course-lesson', learnerId: 'learner4', courseId: COURSE,
        courseTitle: 'Hoffman Academy', unitId: 'season-4', unitTitle: 'Unit 4',
        lessonId: 'plex:9001', lessonTitle: 'Lesson 1',
      });
  });

  it('refuses to launch a lesson the co-progress lock still blocks', async () => {
    const launcher = launcherFor({
      compoundId: COURSE,
      items: [{ id: 'plex:9001', title: 'Lesson 1', parentId: 's4', parentIndex: 4, itemIndex: 1, userWatched: false }],
      coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3 },
    }, '2026-08-25T20:00:00Z');
    await expect(launcher.issueLaunchTarget({ userId: 'learner4', programInstance: COURSE }))
      .rejects.toThrow(/waiting for the paired learner/);
  });

  it('launches the assigned lesson even while the learner is ahead', async () => {
    // The incident this exists to prevent: a child whose last item of the day
    // was a piano lesson could not start it, because a sibling was behind.
    const launcher = launcherFor({
      compoundId: COURSE,
      items: [{ id: 'plex:9001', title: 'Lesson 1', parentId: 's4', parentIndex: 4, itemIndex: 1, userWatched: false }],
      coProgressLock: { locked: true, waitingForId: 'learner3', aheadBy: 3, buffer: 3, exemptLessonIds: ['9001'] },
    }, '2026-08-25T20:00:00Z');
    const target = await launcher.issueLaunchTarget({ userId: 'learner4', programInstance: COURSE });
    expect(target.lessonId).toBe('plex:9001');
  });

  it('dispatches as an explicit interrupt to the Piano kiosk', async () => {
    const calls = [];
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: fakeUnits({
        compoundId: COURSE, info: { title: 'Hoffman Academy' },
        items: [{ id: 'plex:9001', title: 'Lesson 1', userWatched: false }],
      }),
      donow: { dispatch: async (request) => { calls.push(request); return { decision: 'dispatched', message: 'Started.' }; } },
      timezone: TZ, clock: () => new Date('2026-08-25T20:00:00Z'), logger: { warn() {}, info() {} },
    });
    await expect(launcher.launch({ userId: 'learner4', programInstance: COURSE, unitId: `piano-course:${COURSE}` }))
      .resolves.toMatchObject({ decision: 'dispatched' });
    expect(calls[0]).toMatchObject({
      surface: 'piano-kiosk', learnerId: 'learner4', force: 'interrupt', programId: 'piano-course',
      action: { kind: 'course-lesson', courseId: COURSE, lessonId: 'plex:9001', learnerId: 'learner4' },
    });
  });
});

/**
 * WHAT THE CARD'S PROGRESS ROWS MEASURE.
 *
 * These pin the fix for a card that told a child "34 of 366" — a number that
 * moves by one a day out of a denominator they will never reach. The rows now
 * answer "which unit am I in" and "which lesson of it am I on", which is the
 * only reading a seven-year-old can place themselves by.
 */
describe('PianoCourseProgramLauncher progress rows', () => {
  /** A unit of `count` lessons, the first `watched` of them already seen. */
  const unit = (index, title, count, watched = 0) => Array.from({ length: count }, (_, i) => ({
    id: `plex:u${index}e${i + 1}`,
    title: `${title} — Lesson ${i + 1}`,
    parentId: `season-${index}`,
    parentTitle: title,
    parentIndex: index,
    itemIndex: i + 1,
    isReference: false,
    userWatched: i < watched,
    userCompletedAt: null,
  }));

  const courseOf = (...units) => ({
    compoundId: COURSE,
    info: { title: 'Hoffman Academy' },
    items: units.flat(),
  });

  it('counts UNITS on the course row, not every lesson in the course', async () => {
    // Unit 1 finished, unit 2 half done, units 3-4 untouched: the learner is in
    // unit 2 of 4. The old row would have said 8 of 40.
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1 · Getting Started', 10, 10),
      unit(2, 'Unit 2 · Chords & the Grand Staff', 10, 4),
      unit(3, 'Unit 3', 10),
      unit(4, 'Unit 4', 10),
    ), '2026-08-25T20:00:00Z');

    const [course] = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    // `inProgress` is `progressRows.mjs`'s hatch — the segment the learner is
    // standing in, which is NOT counted in `completed`. The location a surface
    // renders is the two added together (`activeProgressPosition`): unit 2 of 4.
    expect(course).toMatchObject({
      scope: 'course', label: 'Course', completed: 1, total: 4, inProgress: 1,
    });
  });

  it('counts LESSONS within the unit the learner is actually in', async () => {
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1 · Getting Started', 10, 10),
      unit(2, 'Unit 2 · Chords & the Grand Staff', 10, 4),
    ), '2026-08-25T20:00:00Z');

    const rows = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(rows[1]).toMatchObject({
      scope: 'module', label: 'Unit 2 · Chords & the Grand Staff',
      completed: 4, total: 10, inProgress: 1,
    });
  });

  it('measures each unit against its OWN length, not an average', async () => {
    // Real courses are lumpy — Hoffman's units run from a handful of lessons to
    // two dozen. A denominator borrowed from a sibling unit would misreport
    // every one of them.
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1', 3, 3),
      unit(2, 'Unit 2', 23, 12),
      unit(3, 'Unit 3', 7),
    ), '2026-08-25T20:00:00Z');

    const rows = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(rows[0]).toMatchObject({ completed: 1, total: 3, inProgress: 1 });
    expect(rows[1]).toMatchObject({ completed: 12, total: 23, inProgress: 1 });
  });

  it('hatches the segment the learner is in, on every scale at once', async () => {
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1', 4, 4),
      unit(2, 'Unit 2', 4, 1),
    ), '2026-08-25T20:00:00Z');

    const rows = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    // Both scales hatch, because both are true at once: the learner is inside
    // unit 2 of the course AND inside a lesson of that unit. An earlier draft
    // marked only the deepest row, which read as though the course bar had no
    // opinion about where they were.
    expect(rows[0]).toMatchObject({ completed: 1, total: 2, inProgress: 1 });
    expect(rows[1]).toMatchObject({ completed: 1, total: 4, inProgress: 1 });
  });

  it('hatches the first unfinished unit, not the last finished one', async () => {
    // Two units done and a third untouched does NOT mean "no present tense":
    // the learner's next lesson lives in unit 3, so unit 3 is where they are
    // standing. Solid 2, hatched 1 — a location of "unit 3 of 3".
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1', 4, 4),
      unit(2, 'Unit 2', 4, 4),
      unit(3, 'Unit 3', 4),
    ), '2026-08-25T20:00:00Z');

    const [course] = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(course).toMatchObject({ completed: 2, total: 3, inProgress: 1 });
  });

  it('drops the hatch entirely once the course is finished', async () => {
    // A finished course is all past tense — `inProgressSegments` returns 0 when
    // `completed` meets `total`, so nothing is left to be standing in.
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1', 4, 4),
      unit(2, 'Unit 2', 4, 4),
    ), '2026-08-25T20:00:00Z');

    const [course] = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(course).toMatchObject({ completed: 2, total: 2 });
    expect(course.inProgress).toBe(0);
  });

  it('does not count a reference unit the learner never advances through', async () => {
    // Reference/practice units give no progression credit, so they are not
    // steps in the sequence and must not inflate the denominator.
    const launcher = launcherFor({
      compoundId: COURSE,
      items: [
        ...unit(1, 'Unit 1', 4, 4),
        ...unit(2, 'Unit 2', 4, 1),
        ...unit(9, 'Practice & Reference', 6).map((item) => ({ ...item, isReference: true })),
      ],
    }, '2026-08-25T20:00:00Z');

    const [course] = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(course).toMatchObject({ completed: 1, total: 2, inProgress: 1 });
  });

  it('keeps the lesson reading for a course with no units at all', async () => {
    // Most courses in the house are a flat list. A synthetic "Unit 1 of 1"
    // would be noise, so the course row stays a lesson count there.
    const launcher = launcherFor({
      compoundId: COURSE,
      items: [
        { id: 'plex:1', title: 'One', itemIndex: 1, userWatched: true },
        { id: 'plex:2', title: 'Two', itemIndex: 2, userWatched: false },
        { id: 'plex:3', title: 'Three', itemIndex: 3, userWatched: false },
      ],
    }, '2026-08-25T20:00:00Z');

    const rows = (await launcher.status({ userId: 'learner3', programInstance: COURSE })).progress;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: 'course', completed: 1, total: 3, inProgress: 1,
    });
  });

  it('leaves the printed slip speaking in course-wide lesson counts', async () => {
    // The slip is an adult-facing paper artifact; "4/40" is the useful figure
    // there. The card asking a different question must not rewrite it.
    const launcher = launcherFor(courseOf(
      unit(1, 'Unit 1', 20, 4),
      unit(2, 'Unit 2', 20),
    ), '2026-08-25T20:00:00Z');

    const status = await launcher.status({ userId: 'learner3', programInstance: COURSE });
    expect(status.progressLabel).toContain('4/40');
    expect(status.score).toBe(10);
  });
});

/**
 * The lesson's own still and blurb, carried out of Plex and into School.
 * Plex stores summaries with Windows line endings and the occasional store
 * link; neither is something a kiosk card should be handed.
 */
describe('PianoCourseProgramLauncher lesson media', () => {
  const episode = (extra = {}) => ({
    compoundId: COURSE,
    info: { title: 'Hoffman Academy' },
    items: [{
      id: 'plex:676040',
      title: 'Rhythm Improvisation with Chords',
      parentId: 'season-2', parentTitle: 'Unit 2', parentIndex: 2, itemIndex: 12,
      isReference: false, userWatched: false, userCompletedAt: null,
      ...extra,
    }],
  });

  const lessonOf = async (result) => {
    const launcher = launcherFor(result, '2026-08-25T20:00:00Z');
    return (await launcher.status({ userId: 'learner3', programInstance: COURSE })).context.lesson;
  };

  it('carries the episode still and summary through to the program context', async () => {
    const lesson = await lessonOf(episode({
      thumbnail: '/api/v1/proxy/plex/library/metadata/676052/thumb/1783605320',
      metadata: { summary: 'How to find high and low notes on your piano' },
    }));
    expect(lesson.thumbnail).toBe('/api/v1/proxy/plex/library/metadata/676052/thumb/1783605320');
    expect(lesson.description).toBe('How to find high and low notes on your piano');
  });

  it('normalises Plex CRLF before the string ever reaches a browser', async () => {
    const lesson = await lessonOf(episode({
      metadata: { summary: 'High and low notes\r\nPattern of 2 and 3 black keys\r\nYour first song' },
    }));
    expect(lesson.description).toBe('High and low notes\nPattern of 2 and 3 black keys\nYour first song');
    expect(lesson.description).not.toContain('\r');
  });

  it('strips the store markup a few Hoffman summaries carry', async () => {
    // A kiosk card renders text. Left in, the tag either shows as literal angle
    // brackets or gets trusted — neither is acceptable.
    const lesson = await lessonOf(episode({
      metadata: {
        summary: 'Learn "Ode to Joy"\r\n\r\n<a href="https://www.hoffmanacademy.com/store" target="_blank">Get the sheet music here.</a>',
      },
    }));
    expect(lesson.description).toBe('Learn "Ode to Joy"\n\nGet the sheet music here.');
  });

  it('omits both for a lesson that carries neither', async () => {
    // The non-Plex case, which is most of School's work.
    const lesson = await lessonOf(episode());
    expect('thumbnail' in lesson).toBe(false);
    expect('description' in lesson).toBe(false);
    expect(lesson.title).toBe('Rhythm Improvisation with Chords');
  });

  it('drops a thumbnail no kiosk could fetch instead of passing it on', async () => {
    const lesson = await lessonOf(episode({ thumbnail: 'http://10.0.0.5:32400/library/metadata/1/thumb' }));
    expect('thumbnail' in lesson).toBe(false);
  });

  it('treats a summary of pure whitespace as no summary at all', async () => {
    const lesson = await lessonOf(episode({ metadata: { summary: '  \r\n \r\n ' }, thumbnail: '   ' }));
    expect('description' in lesson).toBe(false);
    expect('thumbnail' in lesson).toBe(false);
  });
});
