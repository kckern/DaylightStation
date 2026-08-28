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
