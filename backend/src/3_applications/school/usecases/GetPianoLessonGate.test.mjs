import { describe, it, expect, vi } from 'vitest';
import { GetPianoLessonGate } from './GetPianoLessonGate.mjs';

const fakeAssignments = (programs) => ({ get: vi.fn(async () => ({ programs })) });
const fakeLauncher = (statusFn) => ({ id: 'piano-course', status: vi.fn(statusFn) });
const enrolledIn = (...courseIds) => courseIds.map((courseId) => ({ programId: 'piano-course', courseId }));

const NEXT = {
  course: { id: 'plex:1', title: 'Hoffman Academy' },
  unit: { id: '3', title: 'Unit 3' },
  lesson: { id: 'plex:2', title: 'Lesson 5', position: 5, thumbnail: '/api/img.jpg', description: 'Broken chords.' },
};

describe('GetPianoLessonGate', () => {
  it('guest never fetches, never gated', async () => {
    const assignments = fakeAssignments([]);
    const uc = new GetPianoLessonGate({ assignments, launcher: fakeLauncher(async () => ({})), logger: console });
    const result = await uc.execute({ learnerId: 'guest' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('guest');
    expect(assignments.get).not.toHaveBeenCalled();
  });

  it('a missing learnerId is treated as guest, no fetch', async () => {
    const assignments = fakeAssignments([]);
    const uc = new GetPianoLessonGate({ assignments, launcher: fakeLauncher(async () => ({})), logger: console });
    expect((await uc.execute({})).gated).toBe(false);
    expect(assignments.get).not.toHaveBeenCalled();
  });

  it('not enrolled → not gated', async () => {
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments([]), launcher: fakeLauncher(async () => ({})), logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('not-enrolled');
  });

  it('a non-piano program alone does not enrol them here', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([{ programId: 'story-time', courseId: null }]),
      launcher: fakeLauncher(async () => ({})), logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).reason).toBe('not-enrolled');
  });

  it('owed → gated, payload built from nextLesson', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: false, nextLesson: NEXT }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('owed');
    expect(result.course.id).toBe('plex:1');
    expect(result.unit.title).toBe('Unit 3');
    expect(result.lesson).toEqual({
      id: 'plex:2', title: 'Lesson 5', position: 5, thumbnail: '/api/img.jpg', description: 'Broken chords.',
    });
  });

  it("carries the launcher's configured PianoChallenge descriptor without rebuilding it", async () => {
    const challenge = {
      id: 'hoffman-unit-3-chord',
      ask: { id: 'named-c-major', presentation: 'recall', material: [{ kind: 'chord', root: 'C', quality: 'major' }] },
      materialSpec: { kind: 'chord', root: 'C', quality: 'major' },
      framing: 'Play a C major chord.',
    };
    const launcher = fakeLauncher(async () => ({ doneToday: false, nextLesson: NEXT, challenge }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.challenge).toBe(challenge);
  });

  it('omits absent thumbnail/description rather than emitting empties', async () => {
    const launcher = fakeLauncher(async () => ({
      doneToday: false,
      nextLesson: { course: { id: 'plex:1' }, unit: null, lesson: { id: 'plex:2', title: 'Bare' } },
    }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.lesson).toEqual({ id: 'plex:2', title: 'Bare' });
    expect(result.unit).toBeNull();
  });

  it('doneToday → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('done');
  });

  it('excused → not gated (nothing launchable)', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true, excused: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('excused');
  });

  it('bypassed → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: true, excused: true, bypassed: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('bypassed');
  });

  it('course-complete (not done, no nextLesson) → not gated', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: false, nextLesson: null }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: console });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('course-complete');
  });

  it('launcher status().error → fails open', async () => {
    const launcher = fakeLauncher(async () => ({ error: true }));
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: { warn: vi.fn() } });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('launcher status() throwing → fails open', async () => {
    const launcher = fakeLauncher(async () => { throw new Error('plex down'); });
    const uc = new GetPianoLessonGate({ assignments: fakeAssignments(enrolledIn('plex:1')), launcher, logger: { warn: vi.fn() } });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('assignments.get throwing → fails open', async () => {
    const uc = new GetPianoLessonGate({
      assignments: { get: async () => { throw new Error('disk gone'); } },
      launcher: fakeLauncher(async () => ({})), logger: { warn: vi.fn() },
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('unavailable');
  });

  it('multiple enrollments: gated while ANY is owed', async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ doneToday: true })
      .mockResolvedValueOnce({
        doneToday: false,
        nextLesson: { course: { id: 'plex:2' }, unit: null, lesson: { id: 'plex:9', title: 'B lesson' } },
      });
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(enrolledIn('plex:1', 'plex:2')),
      launcher: { id: 'piano-course', status }, logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(true);
    expect(result.lesson.title).toBe('B lesson');
  });

  it('multiple enrollments all discharged → not gated', async () => {
    const status = vi.fn().mockResolvedValue({ doneToday: true });
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(enrolledIn('plex:1', 'plex:2')),
      launcher: { id: 'piano-course', status }, logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('accepts corpusId as the enrollment course key', async () => {
    const launcher = fakeLauncher(async () => ({ doneToday: false, nextLesson: NEXT }));
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([{ programId: 'piano-course', corpusId: 'plex:1' }]),
      launcher, logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).gated).toBe(true);
    expect(launcher.status).toHaveBeenCalledWith({ userId: 'kid1', programInstance: 'plex:1' });
  });
});

/**
 * The daily video cap.
 *
 * `gated` means "you still owe today's lesson" and funnels the kiosk INTO a
 * lesson video. The cap is the opposite end of the same day — "you have had
 * enough" — so it cannot ride on `gated` without the menu trying to launch a
 * lesson at a learner it is trying to stop. It is its own field.
 *
 * The counter is `completedLessonsToday`, which is the same array the launcher
 * maps into `servedWork` and the agenda board draws as discs. Counting anything
 * else would let the board and the cap disagree about the same day.
 */
const cappedAt = (cap, courseId = 'plex:1') => [{ programId: 'piano-course', courseId, videosLockedAfter: cap }];
const doneToday = (n) => ({
  doneToday: n > 0,
  completedLessonsToday: Array.from({ length: n }, (_, i) => ({ lesson: { id: `plex:${i}` } })),
});

describe('GetPianoLessonGate daily video cap', () => {
  it('locks videos once the completed-lesson count reaches the cap', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)), launcher: fakeLauncher(async () => doneToday(2)), logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.videos).toEqual({ locked: true, reason: 'daily-cap', completedToday: 2, cap: 2 });
  });

  it('leaves videos open one lesson short of the cap', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)), launcher: fakeLauncher(async () => doneToday(1)), logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.videos).toEqual({ locked: false, reason: 'under-cap', completedToday: 1, cap: 2 });
  });

  it('stays locked past the cap, never unlocking on overshoot', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)), launcher: fakeLauncher(async () => doneToday(5)), logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).videos.locked).toBe(true);
  });

  // OPTIONAL, and off is the default. Every other learner in the household has
  // no such field, and must be untouched by this.
  it('never locks an enrollment that configures no cap', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(enrolledIn('plex:1')), launcher: fakeLauncher(async () => doneToday(9)), logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.videos).toEqual({ locked: false, reason: 'no-cap', completedToday: 9, cap: null });
  });

  it.each([0, -1, null, 'two', 1.5])('ignores a cap of %p rather than guessing at it', async (cap) => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([{ programId: 'piano-course', courseId: 'plex:1', videosLockedAfter: cap }]),
      launcher: fakeLauncher(async () => doneToday(9)), logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).videos.locked).toBe(false);
  });

  // The cap does not disturb the verdict it rides alongside: a learner who has
  // hit the cap has by definition done today's lesson, so they are not gated.
  it('does not gate a capped learner — the day is discharged, the tap is not', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)), launcher: fakeLauncher(async () => doneToday(2)), logger: console,
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBe('done');
  });

  // FAILS OPEN, like every other unknown in this file. The gate hides kiosk
  // surfaces, and a transient Plex fault must not take Videos away from a child
  // who has watched nothing.
  it('leaves videos open when the launcher read is unavailable', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)),
      launcher: fakeLauncher(async () => { throw new Error('plex is down'); }),
      logger: { warn: vi.fn(), sampled: vi.fn() },
    });
    const result = await uc.execute({ learnerId: 'kid1' });
    expect(result.reason).toBe('unavailable');
    expect(result.videos.locked).toBe(false);
  });

  it('leaves a guest unlocked and unmeasured', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments(cappedAt(2)), launcher: fakeLauncher(async () => doneToday(9)), logger: console,
    });
    expect((await uc.execute({ learnerId: 'guest' })).videos.locked).toBe(false);
  });

  // Two piano enrollments is unusual but legal, and the class already gates on
  // ANY owed one. The cap follows the same shape: the strictest lock wins.
  it('locks when any capped enrollment has reached its cap', async () => {
    const uc = new GetPianoLessonGate({
      assignments: fakeAssignments([
        { programId: 'piano-course', courseId: 'plex:1' },
        { programId: 'piano-course', courseId: 'plex:2', videosLockedAfter: 2 },
      ]),
      launcher: fakeLauncher(async ({ programInstance }) => (
        programInstance === 'plex:2' ? doneToday(2) : doneToday(0)
      )),
      logger: console,
    });
    expect((await uc.execute({ learnerId: 'kid1' })).videos.locked).toBe(true);
  });
});
