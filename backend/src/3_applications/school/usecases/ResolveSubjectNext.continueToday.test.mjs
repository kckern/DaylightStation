import { describe, expect, it, vi } from 'vitest';
import { ResolveSubjectNext } from './ResolveSubjectNext.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';

/**
 * A reading code is minted `continueToday` so the shelf keeps opening once the
 * day's obligation is met — that is where a child adds the next book. The
 * served-day fallback used to read the planner's `inProgress`/`available`
 * snapshots, which are frozen BEFORE `appendAssignedProgramEntries` runs, so
 * the shelf entry was never there and a met obligation closed the shelf.
 *
 * The plan is built by the real append, never by hand: a hand-written plan
 * with the shelf in `available` is exactly what hid this.
 */
const NOW = '2026-09-01T16:00:00.000Z';
const LEARNER_ID = 'user_4';

/** An available english LESSON, as the planner emits it — pushed before the
 * append, the way `plan.entries` really orders curriculum ahead of programs. */
const LESSON = { unitId: 'eng-1', title: 'English 1', subject: 'english', status: 'available', program: null, sessionId: null };

function fixture({ served, withLesson = false }) {
  const assignment = { learnerId: LEARNER_ID, courses: [], programs: [{ programId: 'book-log', subject: 'english' }] };
  const plan = appendAssignedProgramEntries({ entries: withLesson ? [{ ...LESSON }] : [], errors: [] }, assignment);
  const shelf = plan.entries.find((entry) => entry.unitId === 'book-log:shelf');
  const sections = [{
    subject: 'english', progressRows: [],
    servedToday: served, next: served ? null : shelf,
  }];
  const programStatuses = [{
    programId: 'book-log', programInstance: 'shelf',
    status: { enrolled: true, error: false, doneToday: served, terminal: false, progressLabel: null, score: null },
  }];
  const planProjection = { project: vi.fn(async () => ({
    plan, sections, activeExceptions: [], programStatuses,
    projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW },
  })) };
  // A lesson continuation opens a session; a program one never touches this.
  const sessions = {
    async readEvents() { return []; },
    async appendEvent(sessionId, event) { return { ...event, seq: 1 }; },
  };
  const useCase = new ResolveSubjectNext({
    curriculum: {}, assignments: {}, sessions, planProjection,
    newSessionId: () => 'session-new-1', clock: () => new Date(NOW),
  });
  return { useCase, plan };
}

describe('ResolveSubjectNext continueToday on a served reading subject', () => {
  it('reaches the appended shelf entry once the obligation is met', async () => {
    const { useCase, plan } = fixture({ served: true });
    // The plan came from the real append; nothing here was written by hand.
    expect(plan.entries.map((entry) => entry.unitId)).toEqual(['book-log:shelf']);

    const result = await useCase.execute({ learnerId: LEARNER_ID, subject: 'english', continueToday: true });

    expect(result.kind).toBe('program');
    expect(result.programId).toBe('book-log');
    expect(result.unit?.unitId).toBe('book-log:shelf');
  });

  it('with a lesson AND the shelf eligible, a token naming book-log reopens the shelf', async () => {
    // Curriculum precedes programs in `plan.entries` and the two tie on
    // priority, so append order alone would hand the reading code the lesson.
    const { useCase, plan } = fixture({ served: true, withLesson: true });
    expect(plan.entries.map((entry) => entry.unitId)).toEqual(['eng-1', 'book-log:shelf']);

    const result = await useCase.execute({
      learnerId: LEARNER_ID, subject: 'english', continueToday: true, program: 'book-log',
    });

    expect(result).toMatchObject({ kind: 'program', programId: 'book-log', unit: { unitId: 'book-log:shelf' } });
  });

  it('the same plan with no program on the token continues to the lesson — "One more?" still means a lesson', async () => {
    const { useCase } = fixture({ served: true, withLesson: true });

    const result = await useCase.execute({ learnerId: LEARNER_ID, subject: 'english', continueToday: true });

    expect(result.kind).toBe('move');
    expect(result.entry?.unitId).toBe('eng-1');
  });

  it('still answers served without continueToday — the guard is untouched', async () => {
    const { useCase } = fixture({ served: true });
    const result = await useCase.execute({ learnerId: LEARNER_ID, subject: 'english' });
    expect(result).toEqual({ kind: 'served', subjectLabel: 'english' });
  });

  it('an unserved section answers through section.next as before', async () => {
    const { useCase } = fixture({ served: false });
    const result = await useCase.execute({ learnerId: LEARNER_ID, subject: 'english', continueToday: true });
    expect(result).toMatchObject({ kind: 'program', programId: 'book-log', unit: { unitId: 'book-log:shelf' } });
  });
});
