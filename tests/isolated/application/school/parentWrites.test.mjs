/**
 * The two parent-only writes on the lifecycle: signing off a piece of work, and
 * changing what a child is assigned.
 *
 * THE DEFECT THESE PIN. Both used to be raw port calls from the router:
 * `POST /sessions/:id/review/:itemId` took `gradedBy` as a free string and wrote
 * it verbatim, and `PUT /assignments/:learnerId` had no author at all. A child
 * with a browser could sign off their own sheet and assign themselves whatever
 * they liked. The parent UI's grown-up picker is a usability affordance, not a
 * boundary — so the refusal has to live HERE, where HTTP cannot get around it.
 *
 * Everything below therefore calls the use case DIRECTLY, with no router in the
 * picture. If these pass and the router is bypassed entirely, the write is still
 * refused.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GrownUpGate } from '#apps/school/GrownUpGate.mjs';
import { ResolveReviewItem } from '#apps/school/usecases/ResolveReviewItem.mjs';
import { SetAssignments } from '#apps/school/usecases/SetAssignments.mjs';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const AT = new Date('2026-07-27T09:00:00.000Z');
const clock = () => AT;

const ROSTER = [
  { id: 'dad', name: 'Papa', birthyear: 1984 },
  { id: 'learner-1', name: 'Test Learner', birthyear: 2016 },
  { id: 'aunty', name: 'Aunty', birthyear: null },
];

const gate = () => new GrownUpGate({ roster: () => ROSTER, clock });

let reviewQueue;
let assignments;
let resolveReviewItem;
let setAssignments;

beforeEach(() => {
  reviewQueue = {
    resolve: vi.fn(async ({ sessionId, itemId, verdict, gradedBy, at }) => (
      itemId === 'ghost' ? null : { sessionId, itemId, verdict, gradedBy, gradedAt: at }
    )),
  };
  assignments = {
    put: vi.fn(async (record) => ({ ...record })),
  };
  resolveReviewItem = new ResolveReviewItem({ reviewQueue, grownUps: gate(), clock, logger: silent });
  setAssignments = new SetAssignments({ assignments, grownUps: gate(), clock, logger: silent });
});

describe('signing off a review item', () => {
  it('a grown-up marks it, and the verdict is attributed to them at the injected time', async () => {
    const item = await resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'dad',
    });
    expect(item).toMatchObject({ verdict: 'correct', gradedBy: 'dad', gradedAt: AT.toISOString() });
    expect(reviewQueue.resolve).toHaveBeenCalledTimes(1);
  });

  it('REFUSES a child signing off their own work, and writes nothing', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'learner-1',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('REFUSES an id that is not on the roster', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'mr-nobody',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('REFUSES a roster member with no birthyear — a blank field buys nothing', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'correct', gradedBy: 'aunty',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('REFUSES an absent gradedBy rather than recording an anonymous mark', async () => {
    await expect(resolveReviewItem.execute({ sessionId: 'ses_a', itemId: 'q3', verdict: 'correct' }))
      .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('checks who is asking BEFORE it looks at what they asked for', async () => {
    // A forged caller must not learn anything from the shape of the refusal.
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'maybe', gradedBy: 'learner-1',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
  });

  it('rejects a verdict that is not correct|incorrect|void', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'maybe', gradedBy: 'dad',
    })).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('names all three verdicts when it refuses one, so the message is a fix and not a riddle', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'maybe', gradedBy: 'dad',
    })).rejects.toThrow(/correct\|incorrect\|void/);
  });

  it('reports an item that is not queued as not found', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'ghost', verdict: 'correct', gradedBy: 'dad',
    })).rejects.toMatchObject({ name: 'EntityNotFoundError' });
  });

  it('cannot be built without a grown-up gate', () => {
    expect(() => new ResolveReviewItem({ reviewQueue, clock })).toThrow(/grownUps/);
  });
});

/**
 * The third verdict (teacher-coverage 1.1). A grown-up who genuinely cannot
 * mark something — a torn scan, a question that needs the child present —
 * previously had to guess or leave the item pending, and pending strands the
 * whole work session at `submitted` where nothing can clear it. `void` is the
 * honest third answer, and it is the one verdict that must never be silent:
 * it takes a question out of a child's score, so it comes with a sentence
 * they can read or it does not happen at all.
 */
describe('"I cannot mark this" — the void verdict', () => {
  it('records a void with a note, attributed like any other verdict', async () => {
    const item = await resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'void', gradedBy: 'dad',
      note: 'The scan tore across this line — bring me the paper and we will do it together.',
    });
    expect(item).toMatchObject({ verdict: 'void', gradedBy: 'dad', gradedAt: AT.toISOString() });
    expect(reviewQueue.resolve).toHaveBeenCalledWith(expect.objectContaining({
      verdict: 'void',
      note: 'The scan tore across this line — bring me the paper and we will do it together.',
    }));
  });

  it('REFUSES a void with no note — a question dropped from a score is never dropped silently', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'void', gradedBy: 'dad',
    })).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('REFUSES a void whose note is only whitespace — a blank sentence says nothing', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'void', gradedBy: 'dad', note: '   ',
    })).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('an INTERNAL note does not satisfy the requirement — the child never reads that field', async () => {
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'void', gradedBy: 'dad',
      internalNote: 'scanner jam, re-feed later',
    })).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });

  it('leaves correct and incorrect notes OPTIONAL, exactly as they were', async () => {
    for (const verdict of ['correct', 'incorrect']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(resolveReviewItem.execute({ sessionId: 'ses_a', itemId: 'q3', verdict, gradedBy: 'dad' }))
        .resolves.toMatchObject({ verdict });
    }
  });

  it('still checks WHO is asking before it asks about the note', async () => {
    // A child voiding their own hard question, with no note, must be refused
    // as a stranger — not told which field they forgot.
    await expect(resolveReviewItem.execute({
      sessionId: 'ses_a', itemId: 'q3', verdict: 'void', gradedBy: 'learner-1',
    })).rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(reviewQueue.resolve).not.toHaveBeenCalled();
  });
});

describe('changing what a child is assigned', () => {
  const plan = (over = {}) => ({
    learnerId: 'learner-1', courses: ['math-fractions'], units: [], assignedBy: 'dad', ...over,
  });

  it('a grown-up reassigns, and the record is stamped with the injected time', async () => {
    const record = await setAssignments.execute(plan());
    expect(record).toMatchObject({
      learnerId: 'learner-1', courses: ['math-fractions'], units: [], updatedAt: AT.toISOString(),
    });
    expect(assignments.put).toHaveBeenCalledTimes(1);
  });

  it('records WHO changed it, so a reassignment is traceable to a person', async () => {
    expect(await setAssignments.execute(plan())).toMatchObject({ assignedBy: 'dad' });
  });

  it('REFUSES a child assigning themselves, and writes nothing', async () => {
    await expect(setAssignments.execute(plan({ assignedBy: 'learner-1' })))
      .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    expect(assignments.put).not.toHaveBeenCalled();
  });

  it('REFUSES an unknown author, a birthyear-less one, and no author at all', async () => {
    for (const assignedBy of ['mr-nobody', 'aunty', null]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(setAssignments.execute(plan({ assignedBy })))
        .rejects.toMatchObject({ name: 'GuestForbiddenError' });
    }
    expect(assignments.put).not.toHaveBeenCalled();
  });

  it('rejects courses or units that are not arrays', async () => {
    await expect(setAssignments.execute(plan({ courses: 'math' })))
      .rejects.toMatchObject({ name: 'ValidationError' });
    await expect(setAssignments.execute(plan({ units: { a: 1 } })))
      .rejects.toMatchObject({ name: 'ValidationError' });
    expect(assignments.put).not.toHaveBeenCalled();
  });

  it('rejects a missing learnerId rather than writing a record nobody owns', async () => {
    await expect(setAssignments.execute(plan({ learnerId: '' })))
      .rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('cannot be built without a grown-up gate', () => {
    expect(() => new SetAssignments({ assignments, clock })).toThrow(/grownUps/);
  });
});

describe('GrownUpGate', () => {
  it('reads the roster at call time — a member added after boot counts', () => {
    const live = [];
    const g = new GrownUpGate({ roster: () => live, clock });
    expect(g.isAdult('dad')).toBe(false);
    live.push({ id: 'dad', birthyear: 1984 });
    expect(g.isAdult('dad')).toBe(true);
  });

  it('accepts a plain array as well as a function', () => {
    expect(new GrownUpGate({ roster: ROSTER, clock }).isAdult('dad')).toBe(true);
  });

  it('refuses everyone when the roster cannot be read, rather than letting everyone through', () => {
    const g = new GrownUpGate({ roster: () => { throw new Error('roster unavailable'); }, clock });
    expect(g.isAdult('dad')).toBe(false);
  });

  it('assert carries the caller\'s message on the refusal', () => {
    expect(() => gate().assert('learner-1', 'Only a grown-up can sign off schoolwork'))
      .toThrow('Only a grown-up can sign off schoolwork');
  });
});

describe('SetAssignments referential honesty (admin advocacy A4)', () => {
  const curriculum = { listUnits: async () => [
    { unitId: 'frac.01', courseId: 'math-fractions' },
    { unitId: 'caps.01', courseId: 'history-capitals' },
  ] };
  const roster = () => ROSTER;

  it('refuses a course the published catalog does not know, NAMING it', async () => {
    const uc = new SetAssignments({ assignments, grownUps: gate(), curriculum, roster, clock, logger: silent });
    await expect(uc.execute({ learnerId: 'learner-1', courses: ['math-fractions', 'ghost-course'], assignedBy: 'dad' }))
      .rejects.toThrow(/ghost-course/);
    expect(assignments.put).not.toHaveBeenCalled();
  });

  it('refuses a learner who is not on the household roster', async () => {
    const uc = new SetAssignments({ assignments, grownUps: gate(), curriculum, roster, clock, logger: silent });
    await expect(uc.execute({ learnerId: 'nobody', courses: ['math-fractions'], assignedBy: 'dad' }))
      .rejects.toThrow(/roster/);
  });

  it('accepts object-form courses the catalog knows', async () => {
    const uc = new SetAssignments({ assignments, grownUps: gate(), curriculum, roster, clock, logger: silent });
    await expect(uc.execute({
      learnerId: 'learner-1', courses: [{ courseId: 'history-capitals', elective: true }], assignedBy: 'dad',
    })).resolves.toBeTruthy();
  });

  it('a BROKEN catalog degrades to accepting — reference checks must not lock edits shut', async () => {
    const broken = { listUnits: async () => { throw new Error('catalog offline'); } };
    const uc = new SetAssignments({ assignments, grownUps: gate(), curriculum: broken, roster, clock, logger: silent });
    await expect(uc.execute({ learnerId: 'learner-1', courses: ['anything'], assignedBy: 'dad' }))
      .resolves.toBeTruthy();
  });

  it('no curriculum/roster wired keeps the legacy accept-anything behavior', async () => {
    await expect(setAssignments.execute({ learnerId: 'whoever', courses: ['whatever'], assignedBy: 'dad' }))
      .resolves.toBeTruthy();
  });
});

describe('SetAssignments program policy validation', () => {
  const validator = vi.fn((raw) => ({
    errors: [], enrollment: { ...raw, programId: 'sentence-ladder', lessonSize: raw.lessonSize ?? 10 },
  }));
  const make = () => new SetAssignments({
    assignments, grownUps: gate(), clock, logger: silent,
    programValidators: new Map([['sentence-ladder', validator]]),
  });

  it('normalizes the legacy language id before storing', async () => {
    const result = await make().execute({
      learnerId: 'learner-1', assignedBy: 'dad',
      programs: [{ programId: 'language', corpusId: 'korean', lessonSize: 10 }],
    });
    expect(result.programs[0].programId).toBe('sentence-ladder');
    expect(validator).toHaveBeenCalledWith(expect.objectContaining({ programId: 'sentence-ladder' }));
  });

  it('rejects malformed, unknown, and duplicate program policies', async () => {
    await expect(make().execute({ learnerId: 'learner-1', assignedBy: 'dad', programs: ['language'] }))
      .rejects.toThrow(/mappings/);
    await expect(make().execute({ learnerId: 'learner-1', assignedBy: 'dad', programs: [{ programId: 'mystery' }] }))
      .rejects.toThrow(/unknown program/);
    await expect(make().execute({
      learnerId: 'learner-1', assignedBy: 'dad', programs: [
        { programId: 'language', corpusId: 'korean' },
        { programId: 'sentence-ladder', corpusId: 'korean' },
      ],
    })).rejects.toThrow(/duplicate/);
  });
});
