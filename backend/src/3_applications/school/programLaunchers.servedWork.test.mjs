/**
 * ONE INVARIANT, THREE LAUNCHERS: a program that finishes without opening a
 * School work session must say what it served.
 *
 * `AgendaStatusBoard` draws one disc per assignment from PLAN ∪ EVIDENCE. The
 * plan side drops out the moment a program reports `doneToday` (the agenda
 * stops offering it, so the section's `next` goes null), and the evidence side
 * is work sessions — which `BuildAgenda` deliberately never opens for a program
 * entry ("Program entries never get a work session here"). A program with
 * neither leg therefore does not turn its disc green when a child finishes it:
 * the disc LEAVES THE BOARD. That is the bug a child hit on the Sentence
 * Ladder; these three launchers stand in exactly the same place.
 *
 * `servedWork` is the third leg. Launchers report the work only — the agenda
 * stamps `assignmentUnitId` onto every row from the program entry that owns it
 * (`agenda.mjs`), so a launcher must never guess at one itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LanguageReelsProgramLauncher } from './LanguageReelsProgramLauncher.mjs';
import { RubiksCubeProgramLauncher } from './RubiksCubeProgramLauncher.mjs';
import { SurfaceProgramLauncher } from './SurfaceProgramLauncher.mjs';
import { SentenceLadderProgramLauncher } from './SentenceLadderProgramLauncher.mjs';
import { FlashcardProgramLauncher } from './FlashcardProgramLauncher.mjs';
import { StoryTimeProgramLauncher } from './StoryTimeProgramLauncher.mjs';
import { BookLogProgramLauncher } from './BookLogProgramLauncher.mjs';
import { PianoCourseProgramLauncher } from './PianoCourseProgramLauncher.mjs';

describe('LanguageReelsProgramLauncher — served work', () => {
  const make = (status) => new LanguageReelsProgramLauncher({
    service: { status: () => status },
    grants: { issue: () => 'grant' },
  });

  it('names the finished reel once the session is complete', async () => {
    const launcher = make({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
    const result = await launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' });
    expect(result.servedWork).toEqual([{ unitId: 'language-reels:kr-market-day', title: 'Language reel' }]);
  });

  it('keeps everything the service already answered', async () => {
    const launcher = make({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
    await expect(launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' }))
      .resolves.toMatchObject({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 });
  });

  it('reports nothing served for a reel still in progress', async () => {
    const launcher = make({ doneToday: false, terminal: false, progressLabel: 'Reel in progress', score: null });
    await expect(launcher.status({ userId: 'test-learner', programInstance: 'kr-market-day' }))
      .resolves.toMatchObject({ servedWork: [] });
  });
});

describe('RubiksCubeProgramLauncher — served work', () => {
  const make = (status) => new RubiksCubeProgramLauncher({
    service: { status: () => status },
    grants: { issue: () => 'grant' },
  });

  it('names the course on a day an activity was completed', async () => {
    const launcher = make({ doneToday: true, progressLabel: '3 of 12 activities complete', score: 25 });
    const result = await launcher.status({ userId: 'test-learner' });
    expect(result.servedWork).toEqual([{ unitId: 'rubiks-cube:beginner-v1', title: "Rubik's cube" }]);
    expect(result).toMatchObject({ doneToday: true, score: 25 });
  });

  it('reports nothing served on a day nothing was completed', async () => {
    const launcher = make({ doneToday: false, progressLabel: '3 of 12 activities complete', score: 25 });
    await expect(launcher.status({ userId: 'test-learner' })).resolves.toMatchObject({ servedWork: [] });
  });
});

describe('SurfaceProgramLauncher — served work', () => {
  const AT = Date.parse('2026-09-11T18:00:00Z');
  const make = (rows) => new SurfaceProgramLauncher({
    id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness',
    donow: { dispatch: async () => ({ decision: 'dispatched', message: 'Off you go.' }) },
    datastore: { listDispatches: async () => rows },
    timezone: 'UTC', clock: () => new Date(AT), logger: { warn() {} },
  });

  it('names the program once a dispatch has served the day', async () => {
    const result = await make([{ programId: 'pe-daily', learnerId: 'test-learner', at: new Date(AT - 3_600_000).toISOString() }])
      .status({ userId: 'test-learner' });
    expect(result).toMatchObject({ doneToday: true });
    // The label the household authored in `school.yml`, not the program id: a
    // receipt's finished-work line and a disc's spoken name are read by a child.
    expect(result.servedWork).toEqual([{ unitId: 'pe-daily:daily', title: 'P.E.' }]);
  });

  it('reports nothing served on a day with no dispatch of its own', async () => {
    const result = await make([{ programId: 'something-else', learnerId: 'test-learner', at: new Date(AT).toISOString() }])
      .status({ userId: 'test-learner' });
    expect(result).toMatchObject({ doneToday: false, servedWork: [] });
  });

  it('reports nothing served when the dispatch log cannot be read', async () => {
    const launcher = new SurfaceProgramLauncher({
      id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness',
      donow: { dispatch: async () => ({ decision: 'dispatched', message: '' }) },
      datastore: { listDispatches: async () => { throw new Error('disk is gone'); } },
      timezone: 'UTC', clock: () => new Date(AT), logger: { warn() {} },
    });
    // An unreadable ledger is not evidence of work: the degraded answer must
    // never paint a disc green.
    await expect(launcher.status({ userId: 'test-learner' })).resolves.toMatchObject({ doneToday: false, servedWork: [] });
  });
});


// ---------------------------------------------------------------------------
// THE GATE, not the documentation. The three suites above test behaviour one
// launcher at a time, which is worth having and which nothing below replaces —
// but a per-launcher suite cannot notice a launcher nobody wrote a suite for,
// and that is the failure we just lived through six times over.
//
// So this walks the launcher classes the composition root actually registers
// and makes every one of them answer. A NINTH launcher wired into
// `schoolLifecycle.mjs` fails here until it is named in `COVERED` below.
//
// NAMES, NEVER A COUNT. A count passes while coverage moves underneath it: a
// launcher renamed or swapped for another keeps the total at eight while the
// class actually shipping goes untested. Comparing sorted name sets makes the
// diff say which one arrived and which one left.
const SOURCE = readFileSync(
  fileURLToPath(new URL('../../5_composition/modules/schoolLifecycle.mjs', import.meta.url)),
  'utf8',
);
const registeredLauncherNames = () => [...new Set(
  [...SOURCE.matchAll(/\b([A-Z][A-Za-z]*ProgramLauncher)\b/g)].map(([, name]) => name),
)].sort();

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const TODAY = '2026-09-11T18:00:00Z';
const AT = Date.parse(TODAY);
const clock = () => new Date(AT);

/**
 * One entry per registered launcher: build it finished, and build it with the
 * day still open. `done` must produce real completed work; `open` must produce
 * none. Both must answer with an ARRAY — the contract `planDailyAgenda` reads
 * (`Array.isArray(status.servedWork)`), and the reason an absent field is not
 * "no work today" but a launcher the board cannot hear.
 */
const COVERED = {
  SentenceLadderProgramLauncher: {
    done: () => new SentenceLadderProgramLauncher({
      languageStudyService: { todayStatus: () => ({ doneToday: true, progressLabel: 'Day 4', score: null, servedWork: [{ unitId: 'sentence-ladder:test-korean', title: 'Test Korean · Day 4' }] }) },
      donow: null, logger: silent,
    }),
    open: () => new SentenceLadderProgramLauncher({
      languageStudyService: { todayStatus: () => ({ doneToday: false, progressLabel: 'Day 4', score: null, servedWork: [] }) },
      donow: null, logger: silent,
    }),
    args: { userId: 'test-learner', programInstance: 'test-korean' },
  },

  LanguageReelsProgramLauncher: {
    done: () => new LanguageReelsProgramLauncher({ service: { status: () => ({ doneToday: true, terminal: true, progressLabel: 'Reel complete', score: 80 }) }, grants: { issue: () => 'g' } }),
    open: () => new LanguageReelsProgramLauncher({ service: { status: () => ({ doneToday: false, terminal: false, progressLabel: 'Reel in progress', score: null }) }, grants: { issue: () => 'g' } }),
    args: { userId: 'test-learner', programInstance: 'kr-market-day' },
  },

  FlashcardProgramLauncher: {
    done: () => new FlashcardProgramLauncher({
      studyService: { summary: async () => ({ counts: { due: 0, new: 0, learning: 1, mastered: 1, reviewed: 2, activeSeconds: 60 } }) },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'biology/cells', policy: { activeMinutes: 1, minimumReviews: 2, masteryPercent: 50 } }] }) },
    }),
    open: () => new FlashcardProgramLauncher({
      studyService: { summary: async () => ({ counts: { due: 0, new: 0, learning: 0, mastered: 1, reviewed: 99, activeSeconds: 9_999 }, today: { reviewed: 0, activeSeconds: 0 } }) },
      assignments: { get: async () => ({ programs: [{ programId: 'flashcards', deckId: 'biology/cells', policy: { minimumReviews: 1, activeMinutes: 1 } }] }) },
    }),
    args: { userId: 'test-learner', programInstance: 'biology/cells' },
  },

  RubiksCubeProgramLauncher: {
    done: () => new RubiksCubeProgramLauncher({ service: { status: () => ({ doneToday: true, progressLabel: '3 of 12', score: 25 }) }, grants: { issue: () => 'g' } }),
    open: () => new RubiksCubeProgramLauncher({ service: { status: () => ({ doneToday: false, progressLabel: '3 of 12', score: 25 }) }, grants: { issue: () => 'g' } }),
    args: { userId: 'test-learner' },
  },

  SurfaceProgramLauncher: {
    done: () => new SurfaceProgramLauncher({
      id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness', donow: { dispatch: async () => ({}) },
      datastore: { listDispatches: async () => [{ programId: 'pe-daily', learnerId: 'test-learner', at: TODAY }] },
      timezone: 'UTC', clock, logger: silent,
    }),
    open: () => new SurfaceProgramLauncher({
      id: 'pe-daily', label: 'P.E.', surface: 'garage-fitness', donow: { dispatch: async () => ({}) },
      datastore: { listDispatches: async () => [] },
      timezone: 'UTC', clock, logger: silent,
    }),
    args: { userId: 'test-learner' },
  },

  StoryTimeProgramLauncher: {
    done: () => new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [{ bookId: 'b1' }] },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 1, subject: 'english' }] }) },
      timezone: 'UTC', clock, logger: silent,
    }),
    open: () => new StoryTimeProgramLauncher({
      readingLog: { listForDay: async () => [] },
      assignments: { get: async () => ({ programs: [{ programId: 'story-time', target: 1, subject: 'english' }] }) },
      timezone: 'UTC', clock, logger: silent,
    }),
    args: { userId: 'test-learner' },
  },

  BookLogProgramLauncher: {
    done: () => new BookLogProgramLauncher({
      assignments: { get: async () => ({ programs: [{ programId: 'book-log', subject: 'english', obligation: { metric: 'pages', quantity: 20, per: 'day', scope: null } }] }) },
      bookLog: { listForLearner: async () => [{ bookId: 'b1', progressMode: 'page', pageCount: 184, events: [{ kind: 'progress', at: TODAY, page: 20 }] }] },
      timezone: 'UTC', clock, logger: silent,
    }),
    open: () => new BookLogProgramLauncher({
      assignments: { get: async () => ({ programs: [{ programId: 'book-log', subject: 'english', obligation: { metric: 'pages', quantity: 20, per: 'day', scope: null } }] }) },
      bookLog: { listForLearner: async () => [] },
      timezone: 'UTC', clock, logger: silent,
    }),
    args: { userId: 'test-learner' },
  },

  PianoCourseProgramLauncher: {
    // The COMPLETED-LESSON branch. Piano's two excused branches answer
    // `doneToday: true` with EMPTY served work on purpose — see the exception
    // suite at the bottom of this file.
    done: () => new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async () => ({ ok: true, result: { items: [pianoLesson({ userCompletedAt: TODAY, userWatched: true })], parents: {} } }) },
      timezone: 'UTC', clock, logger: silent,
    }),
    open: () => new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async () => ({ ok: true, result: { items: [pianoLesson()], parents: {} } }) },
      timezone: 'UTC', clock, logger: silent,
    }),
    args: { userId: 'test-learner', programInstance: 'plex:1' },
  },
};

function pianoLesson(overrides = {}) {
  return {
    id: 'plex:11', unitId: 'plex:11', title: 'Lesson 11', parentId: 'u1', parentTitle: 'Unit 1',
    parentIndex: 1, itemIndex: 1, isReference: false, userWatched: false, userCompletedAt: null,
    ...overrides,
  };
}

describe('every launcher the composition root registers', () => {
  it('is covered by this suite, BY NAME — a new launcher fails here first', () => {
    expect(registeredLauncherNames()).toEqual(Object.keys(COVERED).sort());
  });

  describe.each(Object.entries(COVERED))('%s', (name, spec) => {
    it('reports an array of completed work when the day is done', async () => {
      const status = await spec.done().status({ ...spec.args });
      expect(status.doneToday, `${name} fixture is not actually finished`).toBe(true);
      expect(Array.isArray(status.servedWork), `${name}.status() must answer with an array`).toBe(true);
      expect(status.servedWork.length).toBeGreaterThan(0);
      for (const work of status.servedWork) {
        expect(typeof work.unitId).toBe('string');
        // The agenda stamps the assignment anchor; a launcher must not guess one.
        expect(work).not.toHaveProperty('assignmentUnitId');
      }
    });

    it('reports an EMPTY array while the day is still open', async () => {
      const status = await spec.open().status({ ...spec.args });
      expect(status.doneToday, `${name} fixture is already finished`).not.toBe(true);
      expect(status.servedWork).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// THE ONE DOCUMENTED EXCEPTION, pinned so that changing it is a decision rather
// than an accident.
//
// A parent-excused piano day and a co-progress-locked one are `doneToday: true`
// with nobody having played anything. They report EMPTY served work — honest on
// both counts: nothing was performed, and a served row is a claim that it was
// (the board paints one green, the printed agenda files it under what the child
// finished). The cost is real and is the reason this is an exception rather
// than a solution: with no work and no `next`, an excused day's disc leaves the
// board exactly as the Sentence Ladder's did. The fix is a board state that can
// say "resolved, but not performed" — see "The exception" in
// docs/reference/school/programs.md — never a green disc bought with a false
// claim.
describe('PianoCourseProgramLauncher — the excused day', () => {
  const excusedBy = (extra) => new PianoCourseProgramLauncher({
    getPlayableUnits: { execute: async () => ({ ok: true, result: { items: [pianoLesson()], parents: {}, ...extra } }) },
    timezone: 'UTC', clock, logger: silent, ...(extra.dayBypasses ? { dayBypasses: extra.dayBypasses } : {}),
  });

  it('a parent bypass finishes the day without claiming work was done', async () => {
    const launcher = new PianoCourseProgramLauncher({
      getPlayableUnits: { execute: async () => ({ ok: true, result: { items: [pianoLesson()], parents: {} } }) },
      dayBypasses: { activeFor: async () => ({ decidedBy: 'a grown-up' }) },
      timezone: 'UTC', clock, logger: silent,
    });
    const status = await launcher.status({ userId: 'test-learner', programInstance: 'plex:1' });
    expect(status).toMatchObject({ doneToday: true, excused: true, bypassed: true });
    expect(status.servedWork).toEqual([]);
  });

  it('a co-progress lock does the same', async () => {
    const launcher = excusedBy({ coProgressLock: { locked: true, waitingForId: 'a sibling', exemptLessonIds: [] } });
    const status = await launcher.status({ userId: 'test-learner', programInstance: 'plex:1' });
    expect(status).toMatchObject({ doneToday: true, excused: true });
    expect(status.servedWork).toEqual([]);
  });
});
