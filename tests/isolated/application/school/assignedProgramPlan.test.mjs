import { describe, it, expect } from 'vitest';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';

describe('appendAssignedProgramEntries — story-time', () => {
  it('projects a story-time enrollment as a daily, courseless english entry', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'story-time', target: 2 }] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      unitId: 'story-time:daily',
      program: 'story-time',
      programInstance: 'daily',
      subject: 'english',
      courseId: null,
      cadence: 'daily',
      elective: false,
    });
  });

  it('uses the enrollment title when one is authored', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'story-time', title: 'Story time' }] });
    expect(plan.entries[0].title).toBe('Story time');
  });

  it('projects and isolates the program enrollment schedule', () => {
    const schedule = { daysOfWeek: [1, 2, 3, 4, 5] };
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'story-time', schedule }] });

    expect(plan.entries[0].schedule).toEqual(schedule);
    schedule.daysOfWeek.push(7);
    expect(plan.entries[0].schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves other program kinds untouched', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'flashcards', deckId: 'd1' }] });
    expect(plan.entries[0].program).toBe('flashcards');
  });
});

describe('appendAssignedProgramEntries — book-log', () => {
  it('appends ONE shelf entry for a book-log enrollment, under its subject', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{
      programId: 'book-log', corpusId: null, subject: 'english', title: null, obligation: null,
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    }] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({
      unitId: 'book-log:shelf', title: 'Reading', subject: 'english', program: 'book-log', programInstance: 'shelf',
      courseId: null, cadence: 'daily', elective: false,
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    });
  });

  it('defaults a book-log entry to english and keeps a given title', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'book-log', title: 'Free reading' }] });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]).toMatchObject({ subject: 'english', title: 'Free reading' });
  });

  // The agenda drops a program entry only when `cadence === 'once'` AND its
  // launcher says the instance is terminal. The launcher already reports a met
  // once-obligation as terminal; the entry must carry the cadence to match, or
  // a finished series stays on every future agenda.
  it('carries cadence once for a once-obligation, so a finished series can leave the agenda', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{
      programId: 'book-log', obligation: { metric: 'books', quantity: 2, per: 'once', scope: { books: ['a', 'b'] } },
    }] });
    expect(plan.entries[0].cadence).toBe('once');
  });

  it('keeps a per-day obligation daily', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{
      programId: 'book-log', obligation: { metric: 'minutes', quantity: 20, per: 'day' },
    }] });
    expect(plan.entries[0].cadence).toBe('daily');
  });
});
