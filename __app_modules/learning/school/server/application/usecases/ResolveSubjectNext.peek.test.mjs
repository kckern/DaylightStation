// @vitest-environment node
/**
 * `ResolveSubjectNext.peek` — the same resolution `execute` gives, read
 * WITHOUT opening a session. A sessionless entry is judged against a synthetic
 * `created` state (`SYNTHETIC_SESSION_ID`), the way the keypad's `/resolve`
 * judges a card, and `sessionId` comes back null. One recipe, two modes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveSubjectNext } from "./ResolveSubjectNext.mjs";
import { CurriculumAccess } from "../CurriculumAccess.mjs";
import { appendAssignedProgramEntries } from "../assignedProgramPlan.mjs";
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore,
  fakeClock, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, WORKSHEET_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

let clock, sessions, useCase;

const build = ({ assignment = { learnerId: 'kid1', courses: ['math-fractions'] }, launchers = new Map() } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => ['language'], clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  const assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  useCase = new ResolveSubjectNext({
    curriculum, assignments, sessions, launchers,
    clock: clock.now, newSessionId: sequentialIds(), logger: silentLogger,
  });
};

beforeEach(() => build());

describe('peek', () => {
  it('resolves the next move against a synthetic created state and opens no session', async () => {
    const peeked = await useCase.peek({ learnerId: 'kid1', subject: 'math' });

    expect(peeked).toMatchObject({ kind: 'move', sessionId: null, move: { kind: 'play' } });
    expect(peeked.state.state).toBe('created');
    expect(peeked.unit).toMatchObject({ unitId: MEDIA_UNIT });
    expect(await sessions.listForLearner('kid1')).toEqual([]);
  });

  it('agrees with execute, and reads the real session once one exists', async () => {
    const peekedFirst = await useCase.peek({ learnerId: 'kid1', subject: 'math' });
    const executed = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(executed.move).toEqual(peekedFirst.move);

    await sessions.appendEvent(executed.sessionId, {
      type: 'media_dispatched', at: clock.iso(), sessionId: executed.sessionId,
      dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:1',
    });
    const peekedAgain = await useCase.peek({ learnerId: 'kid1', subject: 'math' });
    expect(peekedAgain.sessionId).toBe(executed.sessionId);
    expect(peekedAgain.state.state).toBe('media_dispatched');
    expect(await sessions.listForLearner('kid1')).toHaveLength(1);
  });

  it('answers locked and empty exactly as execute does', async () => {
    build({ assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] } });
    expect(await useCase.peek({ learnerId: 'kid1', subject: 'math' }))
      .toEqual({ kind: 'locked', remedy: `Finish “${fixtureUnit(MEDIA_UNIT).title}” first` });
    expect(await useCase.peek({ learnerId: 'kid1', subject: 'history' })).toEqual({ kind: 'empty' });
    expect(await sessions.listForLearner('kid1')).toEqual([]);
  });
});

describe('peek writes nothing on the continuation branches', () => {
  // The planner's output stubbed in the shape `ResolveSubjectNext.continueToday
  // .test.mjs` uses, built by the real `appendAssignedProgramEntries`, with a
  // session store that records every write.
  const NOW = '2026-09-01T16:00:00.000Z';
  const LESSON = { unitId: 'eng-1', title: 'English 1', subject: 'english', status: 'available', program: null, sessionId: null };

  const fixture = ({ served, reopenable = false }) => {
    const assignment = { learnerId: 'kid1', courses: [], programs: [{ programId: 'book-log', subject: 'english' }] };
    const plan = appendAssignedProgramEntries({ entries: [{ ...LESSON }], errors: [] }, assignment);
    const lesson = plan.entries.find((entry) => entry.unitId === LESSON.unitId);
    const sections = [{
      subject: 'english', progressRows: [], servedToday: served,
      next: served ? null : lesson,
      ...(reopenable ? { reopenUnitId: 'book-log:shelf' } : {}),
    }];
    const programStatuses = [{
      programId: 'book-log', programInstance: 'shelf',
      status: {
        enrolled: true, error: false, doneToday: served, terminal: false, progressLabel: null, score: null,
        ...(reopenable ? { reopenable: true } : {}),
      },
    }];
    const planProjection = { project: async () => ({
      plan, sections, activeExceptions: [], programStatuses,
      projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW },
    }) };
    const writes = [];
    const store = {
      async readEvents() { return []; },
      async appendEvent(sessionId, event) { writes.push({ sessionId, event }); return { ...event, seq: 1 }; },
    };
    const resolver = new ResolveSubjectNext({
      curriculum: {}, assignments: {}, sessions: store, planProjection,
      newSessionId: () => 'session-new-1', clock: () => new Date(NOW),
    });
    return { resolver, writes };
  };

  it('continueToday onto a curriculum lesson: execute would open a session, peek does not', async () => {
    const { resolver, writes } = fixture({ served: true });
    const peeked = await resolver.peek({ learnerId: 'kid1', subject: 'english', continueToday: true });
    expect(peeked).toMatchObject({ kind: 'move', sessionId: null, entry: { unitId: 'eng-1' } });
    expect(writes).toEqual([]);

    await resolver.execute({ learnerId: 'kid1', subject: 'english', continueToday: true });
    expect(writes).not.toEqual([]);
  });

  it('a reopenable program on a served subject', async () => {
    const { resolver, writes } = fixture({ served: true, reopenable: true });
    const peeked = await resolver.peek({ learnerId: 'kid1', subject: 'english' });
    expect(peeked).toMatchObject({ kind: 'program', programId: 'book-log' });
    expect(writes).toEqual([]);
  });

  it('a token that names a program', async () => {
    const { resolver, writes } = fixture({ served: false });
    const peeked = await resolver.peek({ learnerId: 'kid1', subject: 'english', program: 'book-log' });
    expect(peeked).toMatchObject({ kind: 'program', programId: 'book-log' });
    expect(writes).toEqual([]);
  });
});
