import { describe, expect, it, vi } from 'vitest';
import { BuildAgenda } from './BuildAgenda.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';

// A `subject_next` code for a subject that carries a `book-log` program must
// keep opening once the day's reading obligation is met — the shelf is where a
// child adds a book, not only where a lesson is finished. `ResolveAccessCode`
// reads `record.subject.continueToday === true` for exactly that.

const NOW = '2026-09-01T16:00:00.000Z';

/**
 * The plan is built the way production builds it — `appendAssignedProgramEntries`
 * over the learner's enrollments — never by hand. A hand-written `book-log`
 * entry once hid that the append had no book-log branch at all, so the launcher
 * was never consulted and the reading code fell through to a lesson.
 */
function fixture({ programs }) {
  const assignment = { learnerId: 'user_4', courses: [], programs };
  const plan = appendAssignedProgramEntries({ entries: [], errors: [] }, assignment);
  const sections = ['english', 'arts'].map((subject) => ({
    subject, servedToday: false, progressRows: [],
    next: plan.entries.find((entry) => entry.subject === subject) ?? null,
  }));
  const planProjection = { project: vi.fn(async () => ({
    plan, sections, activeExceptions: [],
    projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW },
  })) };
  const tokens = { put: vi.fn(async () => {}) };
  const useCase = new BuildAgenda({
    curriculum: {}, assignments: {}, sessions: {}, tokens, planProjection,
    launchers: new Map([
      ['book-log', { locationHint: 'at the school-room panel' }],
      ['story-time', { locationHint: 'on the couch' }],
      ['piano-course', { locationHint: 'on the piano' }],
    ]),
    clock: () => new Date(NOW), timezone: 'America/Los_Angeles',
  });
  return { useCase, tokens, plan };
}

const PIANO = { programId: 'piano-course', subject: 'arts', courseId: 'hoffman' };

const mintedFor = (tokens, subject) => tokens.put.mock.calls
  .map(([record]) => record)
  .find((record) => record.tokenClass === 'subject_next' && record.subject?.subject === subject);

describe('BuildAgenda continueToday on the reading code', () => {
  it('marks the reading subject continueToday when the learner has a book-log program there', async () => {
    const { useCase, tokens, plan } = fixture({ programs: [
      { programId: 'book-log', subject: 'english' },
      PIANO,
    ] });
    // The real append produced the shelf entry the section's `next` points at.
    expect(plan.entries.map((entry) => entry.unitId)).toEqual(['book-log:shelf', 'piano-course:hoffman']);
    await useCase.execute({ learnerId: 'user_4', learnerName: 'User_4' });

    // The token says WHAT it continues to: the shelf, by program id. Without
    // that, a re-entered code on a day with an available english lesson would
    // continue to the lesson — `plan.entries` puts curriculum first.
    expect(mintedFor(tokens, 'english').subject).toEqual({
      learnerId: 'user_4', subject: 'english', continueToday: true, program: 'book-log',
    });
    // Only the reading subject: the piano code keeps its exact prior shape.
    expect(mintedFor(tokens, 'arts').subject).toEqual({ learnerId: 'user_4', subject: 'arts' });
    expect('continueToday' in mintedFor(tokens, 'arts').subject).toBe(false);
  });

  it('defaults an unsubjected book-log enrollment to english', async () => {
    const { useCase, tokens } = fixture({ programs: [{ programId: 'book-log' }, PIANO] });
    await useCase.execute({ learnerId: 'user_4' });

    expect(mintedFor(tokens, 'english').subject.continueToday).toBe(true);
    expect(mintedFor(tokens, 'english').subject.program).toBe('book-log');
    expect('continueToday' in mintedFor(tokens, 'arts').subject).toBe(false);
    expect('program' in mintedFor(tokens, 'arts').subject).toBe(false);
  });

  it('mints the english code without the key when the learner has no book-log program', async () => {
    // Story time is the other english program: the code is minted for the
    // subject, and only a book-log enrollment earns `continueToday`.
    const { useCase, tokens } = fixture({ programs: [{ programId: 'story-time' }, PIANO] });
    await useCase.execute({ learnerId: 'user_4' });

    const english = mintedFor(tokens, 'english');
    expect(english).toBeDefined();
    expect(english.subject).toEqual({ learnerId: 'user_4', subject: 'english' });
    expect('continueToday' in english.subject).toBe(false);
    expect('program' in english.subject).toBe(false);
  });
});
