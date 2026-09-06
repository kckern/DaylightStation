/**
 * THE READING LOG IS OPEN TO EVERY LEARNER — enrolled or not (2026-09-06).
 *
 * A `book-log` enrollment carries an OBLIGATION. It does not grant access:
 * `BookLogProgramLauncher`'s own header says "The shelf works with no
 * enrollment at all." But reachability was derived entirely from it, in three
 * places that only make sense together:
 *
 *   - `subjectsWithReadingShelf` reads `assignment.programs`, so only an
 *     enrolled child's code ever named the program;
 *   - `appendAssignedProgramEntries` appends `book-log:shelf` to `plan.entries`
 *     only from an enrollment;
 *   - `findContinuationEntry` can only return an entry that is IN the plan.
 *
 * In a household where one child of four was enrolled, the other three could
 * not log a book at all — and the failure was silent, because the shelf, its
 * store and its HMAC-granted routes never ask about enrollment. Only the way
 * IN was gated.
 *
 * Two halves, and BOTH are asserted here because either alone is useless: a
 * code that opens nothing, or a shelf nothing can open.
 *
 * The second half has a sharper edge than "it returns empty". With an English
 * section present but no shelf entry, the old resolver fell through to
 * `section.next` — so a reading code opened that child's English LESSON. A
 * wrong answer is worse than no answer, so the unenrolled case below asserts
 * the unitId, not merely that the call succeeded.
 */
import { describe, it, expect } from 'vitest';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { appendAssignedProgramEntries } from '#apps/school/assignedProgramPlan.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import { BOOK_LOG_PROGRAM_ID, BOOK_LOG_SHELF_UNIT_ID } from '#domains/school/bookLog.mjs';

const LEARNER_ID = 'kid1';
const NOW_ISO = '2026-09-06T18:00:00.000Z';
const CODE = '482913';
const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

const ENGLISH_LESSON = {
  unitId: 'eng-1', title: 'English 1', subject: 'english',
  status: 'available', program: null, sessionId: null,
};

/**
 * A plan for a learner with NO `book-log` enrollment — `programs: []`, so
 * `appendAssignedProgramEntries` appends nothing and the plan holds no shelf.
 * The English section is present and unserved, which is the trap: that is what
 * the resolver used to fall through to.
 */
function unenrolledProjection() {
  const assignment = { learnerId: LEARNER_ID, courses: [], programs: [] };
  const plan = appendAssignedProgramEntries({ entries: [{ ...ENGLISH_LESSON }], errors: [] }, assignment);
  const sections = [{
    subject: 'english', servedToday: false, next: plan.entries[0], progressRows: [],
  }];
  return {
    plan,
    async project() {
      return {
        plan, sections, activeExceptions: [], programStatuses: [],
        projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW_ISO },
      };
    },
  };
}

/** The same learner, with no English section at all — nothing assigned yet. */
function emptyProjection() {
  const assignment = { learnerId: LEARNER_ID, courses: [], programs: [] };
  const plan = { entries: [], errors: [] };
  return {
    plan,
    async project() {
      return {
        plan, sections: [], activeExceptions: [], programStatuses: [],
        projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW_ISO },
      };
    },
  };
}

/** The reading code BuildAgenda now mints for every learner. */
function readingCodeRecord() {
  let n = 0;
  return mintToken({
    tokenClass: 'subject_next',
    subject: {
      learnerId: LEARNER_ID, subject: 'english',
      continueToday: true, program: BOOK_LOG_PROGRAM_ID,
    },
    at: NOW_ISO,
    rng: () => { n += 1; return (n % 97) / 97; },
    accessCode: CODE,
    accessCodeExpiresAt: '2026-09-07T11:00:00.000Z',
  });
}

function resolverFor(planProjection) {
  return new ResolveAccessCode({
    tokens: { async getByAccessCode() { return readingCodeRecord(); } },
    curriculum: { async listUnits() { return []; }, async listWorks() { return []; } },
    assignments: { async get() { return { units: [] }; } },
    sessions: {
      async listForLearner() { return []; },
      async readEvents(id) { throw new Error(`test fake: unexpected readEvents(${id})`); },
      async appendEvent(id) { throw new Error(`test fake: /resolve must not write (${id})`); },
    },
    planProjection,
    clock: () => new Date(NOW_ISO),
    logger: noopLogger,
  });
}

describe('reading code — a learner with no book-log enrollment', () => {
  it('opens the SHELF even though the plan holds no shelf entry', async () => {
    const planProjection = unenrolledProjection();
    // Asserted so this cannot pass for the wrong reason: if a future change
    // starts appending a shelf entry without an enrollment, this test would
    // silently stop covering the synthesized path it exists for.
    expect(planProjection.plan.entries.map((e) => e.unitId)).toEqual(['eng-1']);
    expect(planProjection.plan.entries.some((e) => e.program === BOOK_LOG_PROGRAM_ID)).toBe(false);

    const { card, resolution } = await resolverFor(planProjection).resolve({ code: CODE });

    expect(resolution).not.toBeNull();
    expect(resolution.kind).toBe('program');
    expect(resolution.programId).toBe(BOOK_LOG_PROGRAM_ID);
    expect(resolution.unit?.unitId).toBe(BOOK_LOG_SHELF_UNIT_ID);
    expect(card.ok).toBe(true);
  });

  it('never opens the English lesson that shares its subject', async () => {
    // The specific old failure: `section.next` was the English lesson, and a
    // reading code selected it. Opening the wrong work is worse than opening
    // nothing, because the child cannot tell it went wrong.
    const { resolution } = await resolverFor(unenrolledProjection()).resolve({ code: CODE });
    expect(resolution.unit?.unitId).not.toBe('eng-1');
    expect(resolution.kind).not.toBe('move');
  });

  it('works when nothing at all is assigned — no sections, no plan entries', async () => {
    // The other old failure, and the quieter one: with no English section the
    // resolver returned `kind: 'empty'` before it ever looked at the program.
    // A child with no curriculum yet still has books.
    const { card, resolution } = await resolverFor(emptyProjection()).resolve({ code: CODE });
    expect(resolution.kind).toBe('program');
    expect(resolution.unit?.unitId).toBe(BOOK_LOG_SHELF_UNIT_ID);
    expect(card.ok).toBe(true);
  });

  it('draws a card that names the shelf rather than a blank one', async () => {
    // An unenrolled learner has no launcher status, so there is no `context`
    // to project from — the card used to come out with `course: null`, which
    // is the blank-artwork case the poster route exists to refuse.
    const { card } = await resolverFor(unenrolledProjection()).resolve({ code: CODE });
    expect(card.context?.taxonomy?.course?.id).toBe(`program:${BOOK_LOG_PROGRAM_ID}`);
    expect(card.context?.taxonomy?.course?.title).toBe('Independent study');
  });

  it('offers a button that actually opens it — not a card with only a way out', async () => {
    // A resolution that names the shelf but produces no `program` action is
    // the same dead end as no resolution at all, one layer later: the child
    // sees their Reading card and can do nothing but leave. `/act` mounts the
    // shelf from this action's kind.
    const { card } = await resolverFor(unenrolledProjection()).resolve({ code: CODE });
    const kinds = card.actions.map((action) => action.kind);
    expect(kinds).toContain('program');
    expect(kinds).not.toEqual(['exit']);
  });

  it('/resolve still writes nothing', async () => {
    // The invariant the whole use case exists for. The session fake throws on
    // `appendEvent`, so a write would fail this loudly rather than silently
    // opening a session for a child who only typed six digits.
    const { card } = await resolverFor(unenrolledProjection()).resolve({ code: CODE });
    expect(card.ok).toBe(true);
  });
});

describe('reading code — an ENROLLED learner is unchanged', () => {
  /** The enrolled shape: the enrollment appends a real shelf entry. */
  function enrolledProjection() {
    const assignment = {
      learnerId: LEARNER_ID, courses: [],
      programs: [{ programId: BOOK_LOG_PROGRAM_ID, subject: 'english', title: 'Reading' }],
    };
    const plan = appendAssignedProgramEntries({ entries: [{ ...ENGLISH_LESSON }], errors: [] }, assignment);
    const sections = [{
      subject: 'english', servedToday: true, next: null, progressRows: [],
    }];
    const programStatuses = [{
      programId: BOOK_LOG_PROGRAM_ID, programInstance: 'shelf',
      status: {
        enrolled: true, error: false, doneToday: true, terminal: false, reopenable: true,
        context: {
          course: { id: `program:${BOOK_LOG_PROGRAM_ID}`, title: 'Independent study' },
          lesson: { id: BOOK_LOG_SHELF_UNIT_ID, title: 'Reading' },
        },
        progressLabel: null, score: null,
      },
    }];
    return {
      plan,
      async project() {
        return {
          plan, sections, activeExceptions: [], programStatuses,
          projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW_ISO },
        };
      },
    };
  }

  it('still resolves through the PLANNED entry, not a synthesized one', async () => {
    const planProjection = enrolledProjection();
    expect(planProjection.plan.entries.map((e) => e.unitId)).toEqual(['eng-1', BOOK_LOG_SHELF_UNIT_ID]);

    const { resolution } = await resolverFor(planProjection).resolve({ code: CODE });

    expect(resolution.kind).toBe('program');
    expect(resolution.unit?.unitId).toBe(BOOK_LOG_SHELF_UNIT_ID);
    // The planned entry carries the enrollment's own title through the
    // launcher context; a synthesized one could only ever say "Reading".
    expect(resolution.unit?.programContext?.lesson?.title).toBe('Reading');
  });

  it('refuses an UNREADABLE shelf, while an ABSENT status is not a fault', async () => {
    // The two must stay distinguishable. `error: true` means the store would
    // not answer and the child should be told; no status at all just means
    // this learner has no plan entry, which is the ordinary unenrolled case.
    const planProjection = enrolledProjection();
    const broken = {
      plan: planProjection.plan,
      async project() {
        const base = await planProjection.project();
        return {
          ...base,
          programStatuses: [{
            programId: BOOK_LOG_PROGRAM_ID, programInstance: 'shelf',
            status: { enrolled: null, error: true, doneToday: false, terminal: false },
          }],
        };
      },
    };
    const { resolution } = await resolverFor(broken).resolve({ code: CODE });
    expect(resolution.kind).toBe('unavailable');
  });
});
