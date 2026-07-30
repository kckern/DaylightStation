import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore,
  fakeClock, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, WORKSHEET_UNIT, MEDIA_BANK_ID, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

// Used only by the program-path tests, mirroring buildAgenda.test.mjs's fixture.
const PROGRAM_ID = 'lang-app';
// Used only by the launch-unit tests below.
const LAUNCH_SURFACE = 'garage-fitness';

let clock, sessions, assignments, useCase;

const build = ({
  assignment = { learnerId: 'kid1', courses: ['math-fractions'] },
  units, launchers = new Map(),
  // A launch unit validates only if the catalog's surface registry knows the
  // surface it names (spec §6, unitValidation's `surfaceValidators` set) — a
  // stand-in `() => []` (always-valid) mirrors `DoNowService`'s real
  // registered adapters closely enough for a routing test, without pulling in
  // a whole DoNow surface.
  surfaceValidators = () => new Map([[LAUNCH_SURFACE, () => []]]),
} = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [PROGRAM_ID], surfaceValidators,
    clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  useCase = new ResolveSubjectNext({
    curriculum, assignments, sessions, launchers,
    clock: clock.now, newSessionId: sequentialIds(), logger: silentLogger,
  });
};

/** Turn WORKSHEET_UNIT into a standalone launch unit — same derivation
 * pattern as `withLanguageProgram` below. */
const withLaunchUnit = () => ({
  units: rawUnits({
    [WORKSHEET_UNIT]: {
      launch: { surface: LAUNCH_SURFACE, episodeId: 'plex:999' },
      courseId: undefined, sequence: undefined, passing: undefined,
      retry: undefined, reward: undefined, review: undefined, document: undefined,
    },
  }),
  assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] },
});

/** Turn WORKSHEET_UNIT into a standalone program unit — same derivation as
 * buildAgenda.test.mjs's `withLanguageProgram`, so a program-path test does
 * not need to author a second fixture that could drift from the real one. */
const withLanguageProgram = () => ({
  units: rawUnits({
    [WORKSHEET_UNIT]: {
      subject: 'language', program: PROGRAM_ID, cadence: 'once',
      courseId: undefined, sequence: undefined, passing: undefined,
      retry: undefined, reward: undefined, review: undefined, document: undefined,
    },
  }),
  assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] },
});

beforeEach(() => build());

describe('a subject already served today', () => {
  it('resolves served, never a curriculum move', async () => {
    const first = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(first.kind).toBe('move');
    const sessionId = first.sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result).toEqual({ kind: 'served', subjectLabel: 'math' });
  });
});

describe('a subject with nothing assigned', () => {
  it('resolves empty, not a crash and not a move', async () => {
    build({ assignment: null });
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result).toEqual({ kind: 'empty' });
  });
});

describe('a locked subject', () => {
  it('resolves locked with the remedy naming the blocking unit', async () => {
    // Only unit 2 assigned (not unit 1) — the whole subject is locked with no
    // offer, same fixture buildAgenda.test.mjs uses for the identical case.
    build({ assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] } });
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result).toEqual({ kind: 'locked', remedy: `Finish “${fixtureUnit(MEDIA_UNIT).title}” first` });
  });
});

describe('a subject behind a program that will not answer', () => {
  it('resolves unavailable rather than throwing or offering stale work', async () => {
    // No launcher registered for PROGRAM_ID — the missing-launcher branch of
    // the try/catch, same as a real throw.
    build(withLanguageProgram());
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'language' });
    expect(result).toEqual({ kind: 'unavailable' });
  });
});

describe('a program subject', () => {
  it('resolves program with the launcher-bound programId and its unit', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, { status: async () => ({ doneToday: false, progressLabel: null, score: null }) }]]),
    });
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'language' });
    expect(result.kind).toBe('program');
    expect(result.programId).toBe(PROGRAM_ID);
    expect(result.unit).toMatchObject({ unitId: WORKSHEET_UNIT, program: PROGRAM_ID });
  });
});

describe('a failed unit due today', () => {
  const failToday = async () => {
    const first = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    const sessionId = first.sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 20 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'needs_remediation' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    return sessionId;
  };

  it('resolves a retry move against the FAILED session — never already_done', async () => {
    const failedSessionId = await failToday();
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result.kind).toBe('move');
    expect(result.kind).not.toBe('served');
    expect(result.move).toMatchObject({ kind: 'retry', tokenClass: 'remediation' });
    // ensureSession REUSES the open (non-terminal) session — outcome_recorded
    // is not terminal, so this is still the session the outcome lives on, not
    // a fresh one. Opening the new one is `OpenRemediation`'s job downstream.
    expect(result.sessionId).toBe(failedSessionId);
    expect(result.state.state).toBe('outcome_recorded');
    expect(result.state.outcome).toMatchObject({ result: 'needs_remediation' });
  });
});

describe('a media+bank unit that finished watching', () => {
  it('resolves a screen move — NEVER play — once media_completed', async () => {
    const sid = 'ses_m';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent(sid, {
      type: 'media_dispatched', at: clock.iso(), sessionId: sid,
      dispatchId: 'dsp_1', target: 'living-room-tv', contentId: 'plex:481203',
    });
    await sessions.appendEvent(sid, { type: 'media_completed', at: clock.iso(), sessionId: sid, verified: 'playhead' });

    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result.kind).toBe('move');
    expect(result.move.kind).toBe('screen');
    expect(result.move.kind).not.toBe('play');
    expect(result.unit).toMatchObject({ unitId: MEDIA_UNIT, bank: MEDIA_BANK_ID });
    expect(result.sessionId).toBe(sid);
  });
});

describe('a launch unit at created (Task 12, spec §6)', () => {
  it('resolves move.kind "launch", tokenClass select_unit, with the unit carrying its launch block', async () => {
    build(withLaunchUnit());
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result.kind).toBe('move');
    expect(result.move).toMatchObject({ kind: 'launch', tokenClass: 'select_unit', label: 'go do this' });
    expect(result.unit).toMatchObject({
      unitId: WORKSHEET_UNIT, launch: { surface: LAUNCH_SURFACE, episodeId: 'plex:999' },
    });
  });

  it('a labelHint on the launch block overrides the default wording', async () => {
    build({
      units: rawUnits({
        [WORKSHEET_UNIT]: {
          launch: { surface: LAUNCH_SURFACE, episodeId: 'plex:999', labelHint: 'go ride the bike' },
          courseId: undefined, sequence: undefined, passing: undefined,
          retry: undefined, reward: undefined, review: undefined, document: undefined,
        },
      }),
      assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] },
    });
    const result = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(result.move.label).toBe('go ride the bike');
  });
});

describe('the session ensured for a move', () => {
  it('is created once and reused on a second resolve — never a second session', async () => {
    const first = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    const second = await useCase.execute({ learnerId: 'kid1', subject: 'math' });
    expect(first.sessionId).toBe(second.sessionId);
    expect(sessions.ids()).toEqual([first.sessionId]);
  });
});
