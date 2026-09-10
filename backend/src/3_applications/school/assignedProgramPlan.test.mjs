import { describe, it, expect } from 'vitest';
import { appendAssignedProgramEntries } from './assignedProgramPlan.mjs';

const plan = () => ({ entries: [] });

describe('appendAssignedProgramEntries — the sentence ladder', () => {
  // Found live 2026-09-09: two learners enrolled in `sentence-ladder` /
  // `glossika-korean` and NEITHER had a `language` section on the agenda. This
  // function knew flashcards, story-time, book-log and piano-course — and had
  // never heard of the ladder, so the enrolment produced no plan entry, no
  // section, no disc. The August integration design had routed the ladder
  // through an authored curriculum unit instead; that unit was never written.
  it('turns a sentence-ladder enrolment into a program entry the agenda can see', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{
        programId: 'sentence-ladder', corpusId: 'glossika-korean', subject: 'language',
        title: 'Korean', lessonSize: 20, rungs: ['repetition'],
        schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
      }],
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({
      unitId: 'sentence-ladder:glossika-korean',
      title: 'Korean',
      subject: 'language',
      program: 'sentence-ladder',
      programInstance: 'glossika-korean',
      cadence: 'daily',
      elective: false,
      schedule: { daysOfWeek: [1, 2, 3, 4, 5] },
    });
  });

  it('defaults the subject and title when the enrolment names neither', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{ programId: 'sentence-ladder', corpusId: 'glossika-korean' }],
    });
    expect(out.entries[0]).toMatchObject({ subject: 'language', title: 'Language practice' });
  });

  it('skips an enrolment that names no corpus — there is nothing to open', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{ programId: 'sentence-ladder' }],
    });
    expect(out.entries).toHaveLength(0);
  });
});
