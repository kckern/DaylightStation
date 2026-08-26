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

  it('leaves other program kinds untouched', () => {
    const plan = { entries: [] };
    appendAssignedProgramEntries(plan, { programs: [{ programId: 'flashcards', deckId: 'd1' }] });
    expect(plan.entries[0].program).toBe('flashcards');
  });
});
