import { describe, it, expect } from 'vitest';
import { appendAssignedProgramEntries } from "./assignedProgramPlan.mjs";

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

describe('appendAssignedProgramEntries — flashcards subject', () => {
  // Found live 2026-09-23: a Korean card-ladder enrolment hard-coded
  // `subject: 'flashcards'`, which is not one of `SUBJECT_IDS`, so the
  // agenda bucketed the card into 'other' instead of 'language'.
  it('carries the enrollment subject onto the entry when one is authored', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{ programId: 'flashcards', deckId: 'korean-1', subject: 'language' }],
    });
    expect(out.entries[0].subject).toBe('language');
  });

  it('defaults to flashcards when the enrollment names no subject', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{ programId: 'flashcards', deckId: 'd1' }],
    });
    expect(out.entries[0].subject).toBe('flashcards');
  });
});

describe('appendAssignedProgramEntries — optional programs', () => {
  it('marks an elective program entry elective and leaves others required', () => {
    const plan = appendAssignedProgramEntries({ entries: [] }, { programs: [
      { programId: 'flashcards', deckId: 'language/x/week-01', title: 'Words', elective: true },
      { programId: 'piano-course', courseId: 'plex:1' },
    ] });
    expect(plan.entries.map((e) => [e.unitId, e.elective])).toEqual([
      ['flashcards:language/x/week-01', true],
      ['piano-course:plex:1', false],
    ]);
  });
});

describe('appendAssignedProgramEntries — the after-school debrief', () => {
  // Found live 2026-10-21 at rollout: the enrolment validated and the launcher
  // registered, but with no branch here the agenda never consulted it — no
  // card, no panel code. The same gap the sentence ladder hit on 2026-09-09.
  it('turns a school-debrief enrolment into one daily program entry', () => {
    const schedule = { daysOfWeek: [1, 2, 3, 4, 5], except: [{ from: '2026-11-11', to: '2026-11-11' }] };
    const out = appendAssignedProgramEntries(plan(), {
      programs: [{ programId: 'school-debrief', corpusId: null, subject: 'writing', title: 'After-school debrief', schedule }],
    });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({
      unitId: 'school-debrief:daily', program: 'school-debrief', programInstance: 'daily',
      subject: 'writing', title: 'After-school debrief', schedule,
    });
  });
});

describe('appendAssignedProgramEntries — printed activities', () => {
  it('turns each printed-activity enrolment into its own program entry, keyed by corpus', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [
        { programId: 'printed-activity', corpusId: 'beeloo:maze', subject: 'arts', title: 'Maze',
          activity: { platform: 'beeloo', kind: 'maze', level: 2, paper: 'letter' } },
        { programId: 'printed-activity', corpusId: 'beeloo:sudoku', subject: 'math', title: null,
          activity: { platform: 'beeloo', kind: 'sudoku', level: 1, paper: 'letter' }, elective: true },
      ],
    });
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({
      unitId: 'printed-activity:beeloo:maze', title: 'Maze', subject: 'arts',
      program: 'printed-activity', programInstance: 'beeloo:maze', cadence: 'daily', elective: false,
    });
    expect(out.entries[1]).toMatchObject({
      unitId: 'printed-activity:beeloo:sudoku', title: 'Sudoku', subject: 'math',
      programInstance: 'beeloo:sudoku', elective: true,
    });
  });

  it('skips an enrolment that names no corpus', () => {
    const out = appendAssignedProgramEntries(plan(), { programs: [{ programId: 'printed-activity', subject: 'arts' }] });
    expect(out.entries).toEqual([]);
  });
});

describe('appendAssignedProgramEntries — disc icons', () => {
  it('carries an enrollment icon onto its entry and defaults piano-course to the music note', () => {
    const out = appendAssignedProgramEntries(plan(), {
      programs: [
        { programId: 'piano-course', courseId: 'plex:1' },
        { programId: 'piano-course', courseId: 'plex:2', icon: 'piano' },
        { programId: 'printed-activity', corpusId: 'beeloo:coloring', subject: 'arts', icon: 'crayon',
          activity: { platform: 'beeloo', kind: 'coloring', level: 1 } },
        { programId: 'printed-activity', corpusId: 'beeloo:maze', subject: 'arts',
          activity: { platform: 'beeloo', kind: 'maze', level: 1 } },
        { programId: 'story-time', icon: 'book-starting' },
        { programId: 'school-debrief' },
      ],
    });
    expect(out.entries.map((e) => [e.unitId, e.icon])).toEqual([
      ['piano-course:plex:1', 'music'],
      ['piano-course:plex:2', 'piano'],
      ['printed-activity:beeloo:coloring', 'crayon'],
      ['printed-activity:beeloo:maze', null],
      ['story-time:daily', 'book-starting'],
      ['school-debrief:daily', 'keyboard'],
    ]);
  });
});
