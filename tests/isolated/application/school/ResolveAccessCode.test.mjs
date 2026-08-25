/**
 * ResolveAccessCode — a typed panel code becomes a launch card, and NOTHING
 * else happens (self-service access codes design, §4).
 *
 * The first describe block is the reason this use case exists at all: the
 * scan-time resolver ensures a session, and ensuring one for an entry that has
 * none APPENDS a `created` event. A child typing a sibling's six digits must
 * not write into that sibling's history, so this path reads and only reads.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, FakeTokenRegistry,
  fakeClock, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, WORKSHEET_UNIT, MEDIA_BANK_ID, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

const CODE = '481920';
const SIBLING_CODE = '735104';
/** The next 4am study-day rollover after the fake clock's 2026-07-27T09:00Z. */
const TOMORROW = '2026-07-28T04:00:00.000Z';
/** Already past when the fake clock reads — a code printed yesterday. */
const YESTERDAY = '2026-07-27T04:00:00.000Z';

const MEDIA_SURFACE = Object.freeze({ id: 'livingroom-tv', label: 'living room' });

let clock, sessions, tokens, assignments, useCase, appended, bankAsked;

/**
 * A sessions port that DELEGATES every read to the real fake and RECORDS every
 * write. Spreading the fake would drop its methods (private fields, class
 * instance), so the recorder wraps rather than copies.
 */
const recordingSessions = (repo, log) => ({
  listForLearner: (learnerId) => repo.listForLearner(learnerId),
  readEvents: (sessionId) => repo.readEvents(sessionId),
  async appendEvent(sessionId, event) {
    log.push([sessionId, event]);
    return repo.appendEvent(sessionId, event);
  },
});

const build = async ({
  assignmentSeed = [{ learnerId: 'kid1', courses: ['math-fractions'] }],
  units,
  canIssueBank = () => false,
  mediaSurface = MEDIA_SURFACE,
  codes = [{ code: CODE, learnerId: 'kid1', subject: 'math' }],
  programIds = [],
  launchers = new Map(),
  roster = { displayName: (id) => ({ kid1: 'Kid One', kid2: 'Kid Two' })[id] ?? null },
} = {}) => {
  clock = fakeClock();
  appended = [];
  bankAsked = [];
  const catalog = new FakeCatalog({
    units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => programIds,
    clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignmentSeed);
  tokens = new FakeTokenRegistry({ now: clock.iso });

  const rng = seededRng();
  for (const seed of codes) {
    const record = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: seed.learnerId, subject: seed.subject },
      at: clock.iso(),
      rng,
      expiresAt: new Date(clock.epoch() + 168 * 3_600_000).toISOString(),
      accessCode: seed.code,
      accessCodeExpiresAt: seed.accessCodeExpiresAt ?? TOMORROW,
    });
    // eslint-disable-next-line no-await-in-loop
    await tokens.put(record);
    // eslint-disable-next-line no-await-in-loop
    if (seed.revoked) await tokens.revoke(record.token, { at: clock.iso() });
  }

  useCase = new ResolveAccessCode({
    tokens,
    curriculum,
    assignments,
    sessions: recordingSessions(sessions, appended),
    launchers,
    issueDocument: {
      canIssueBank: (bankId) => { bankAsked.push(bankId); return canIssueBank(bankId); },
    },
    roster,
    selfService: { mediaSurface },
    clock: clock.now,
    logger: silentLogger,
  });
};

/** A finished session for a unit, written straight to the repository. */
const completeUnit = async (learnerId, unitId, sessionId) => {
  const events = [
    { type: 'created', learnerId, unitId },
    { type: 'issued', artifactId: 'art_1' },
    { type: 'submitted', transport: 'paper' },
    { type: 'graded', attemptIds: ['att_1'], percent: 90 },
    { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
  ];
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop
    await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
  }
};

beforeEach(async () => { await build(); });

// ---------------------------------------------------------------------------
// THE POINT OF THE WHOLE TASK
// ---------------------------------------------------------------------------

describe('reading a code', () => {
  it('appends no events when the entry has no session yet', async () => {
    const card = await useCase.execute({ code: CODE });

    expect(card.actions.length).toBeGreaterThan(0);
    expect(appended).toEqual([]);
    // Belt and braces: not one session exists in the repository afterwards.
    expect(sessions.ids()).toEqual([]);
  });

  it('still appends nothing when the code is typed twice', async () => {
    await useCase.execute({ code: CODE });
    await useCase.execute({ code: CODE });
    expect(appended).toEqual([]);
  });

  it('reads the session a plan entry already carries, without writing to it', async () => {
    // The session BuildAgenda opened this morning, with the video already
    // watched. A synthetic `created` state would offer [play]; the real events
    // say the video is done, so the card must offer the questions instead —
    // which is how this test proves the reduction came from disk.
    for (const event of [
      { type: 'created', learnerId: 'kid1', unitId: MEDIA_UNIT },
      { type: 'media_dispatched', dispatchId: 'dsp_1', target: 'livingroom-tv', contentId: 'plex:1' },
      { type: 'media_completed', verified: true },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent('ses_open', { ...event, sessionId: 'ses_open', at: clock.iso() });
    }
    appended.length = 0;

    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.title).toBe(fixtureUnit(MEDIA_UNIT).title);
    expect(card.actions[0]).toMatchObject({ kind: 'screen', label: 'Answer on the screen' });
    expect(appended).toEqual([]);
    expect(sessions.ids()).toEqual(['ses_open']);
  });
});

// ---------------------------------------------------------------------------
// never a dead end
// ---------------------------------------------------------------------------

describe('telling a bad code apart from a broken backend', () => {
  /**
   * The two refusals are both `{ok: false}` 200s and mean opposite things: a
   * bad code keeps the child on the keypad, a fault has to offer a retry.
   * Without `reason` a panel can only tell them apart by matching the
   * user-facing sentence — so rewording that copy for a child would take the
   * retry button away with nothing to notice. These assertions are what stop
   * the field being dropped in a later tidy-up.
   */
  it('marks an unusable code unknown_code', async () => {
    const card = await useCase.execute({ code: '000000' });
    expect(card.ok).toBe(false);
    expect(card.reason).toBe('unknown_code');
  });

  it('marks a backend fault not_answering', async () => {
    const broken = new ResolveAccessCode({
      tokens,
      curriculum: { listUnits: async () => { throw new Error('catalog on fire'); }, listWorks: async () => [] },
      assignments,
      sessions: recordingSessions(sessions, appended),
      clock: clock.now,
      logger: silentLogger,
    });
    const card = await broken.execute({ code: CODE });
    expect(card.ok).toBe(false);
    expect(card.reason).toBe('not_answering');
    // The two must never collide, or the discriminator discriminates nothing.
    expect(card.reason).not.toBe('unknown_code');
  });

  it('carries the reason through the resolve() shape /act reads', async () => {
    const { card, resolution } = await useCase.resolve({ code: '000000' });
    expect(card.reason).toBe('unknown_code');
    expect(resolution).toBeNull();
  });
});

describe('a code that does not work', () => {
  it('answers try again for a code that was never minted', async () => {
    const card = await useCase.execute({ code: '000000' });
    expect(card.ok).toBe(false);
    expect(card.sentence).toBe('Try again.');
    expect(card.actions).toEqual([]);
  });

  it('answers try again for a code whose study day has rolled over', async () => {
    await build({ codes: [{ code: CODE, learnerId: 'kid1', subject: 'math', accessCodeExpiresAt: YESTERDAY }] });
    const card = await useCase.execute({ code: CODE });
    expect(card.ok).toBe(false);
    expect(card.sentence).toBe('Try again.');
  });

  it('answers try again for a revoked token', async () => {
    await build({ codes: [{ code: CODE, learnerId: 'kid1', subject: 'math', revoked: true }] });
    const card = await useCase.execute({ code: CODE });
    expect(card.ok).toBe(false);
    expect(card.sentence).toBe('Try again.');
  });

  it('never throws on junk input', async () => {
    for (const junk of [undefined, null, '', '   ', 'abcdef', '４８１９２０', '__proto__', 12345, {}, []]) {
      // eslint-disable-next-line no-await-in-loop
      const card = await useCase.execute({ code: junk });
      expect(card.ok).toBe(false);
      expect(card.sentence).toBe('Try again.');
    }
    expect(appended).toEqual([]);
  });

  it('never throws when the curriculum cannot be read', async () => {
    await build();
    const broken = new ResolveAccessCode({
      tokens,
      curriculum: { listUnits: async () => { throw new Error('catalog on fire'); }, listWorks: async () => [] },
      assignments,
      sessions: recordingSessions(sessions, appended),
      clock: clock.now,
      logger: silentLogger,
    });
    const card = await broken.execute({ code: CODE });
    expect(card.ok).toBe(false);
    expect(card.actions).toEqual([]);
    expect(card.sentence).toMatch(/grown-up/);
  });
});

// ---------------------------------------------------------------------------
// the card itself
// ---------------------------------------------------------------------------

describe('a code that works', () => {
  it('names the learner, the subject and the lesson, and offers the work', async () => {
    const card = await useCase.execute({ code: CODE });

    expect(card).toMatchObject({
      schema: 'school.self-service-card/v2',
      ok: true,
      learner: 'kid1',
      subject: 'math',
      title: fixtureUnit(MEDIA_UNIT).title,
      sentence: null,
      context: {
        learner: { id: 'kid1', displayName: 'Kid One', avatar: { kind: 'learner', id: 'kid1' } },
        taxonomy: {
          subject: { id: 'math', label: 'Math & Money' },
          course: {
            id: 'math-fractions', title: 'math-fractions',
            artwork: { kind: 'course-poster', courseId: 'math-fractions' },
          },
          lesson: { id: MEDIA_UNIT, title: fixtureUnit(MEDIA_UNIT).title },
        },
      },
    });
    // Unit 1 carries media, so the card sends the child to the configured room.
    expect(card.actions).toMatchObject([
      {
        kind: 'play', label: 'Play in the living room', target: 'livingroom-tv',
        role: 'primary', operation: 'play', followUp: 'message',
      },
      { kind: 'exit', label: 'Go back', role: 'secondary', operation: 'exit', followUp: 'close' },
    ]);
  });

  it('threads canIssueBank into the print-or-screen choice', async () => {
    // Unit 1 with its media removed is a bank-only unit — the one composition
    // whose action depends on a question this layer has to ask IssueDocument.
    const bankOnly = () => rawUnits({ [MEDIA_UNIT]: { media: undefined } });

    await build({ units: bankOnly(), canIssueBank: () => false });
    const onScreen = await useCase.execute({ code: CODE });
    expect(onScreen.actions[0]).toMatchObject({ kind: 'screen', label: 'Answer on the screen' });
    expect(bankAsked).toEqual([MEDIA_BANK_ID]);

    await build({ units: bankOnly(), canIssueBank: () => true });
    const onPaper = await useCase.execute({ code: CODE });
    expect(onPaper.actions[0]).toMatchObject({ kind: 'print', label: 'Print your worksheet' });
  });

  it('resolves a sibling code to THAT sibling card, with no panel memory', async () => {
    await build({
      assignmentSeed: [
        { learnerId: 'kid1', courses: ['math-fractions'] },
        { learnerId: 'kid2', units: [MEDIA_UNIT] },
      ],
      codes: [
        { code: CODE, learnerId: 'kid1', subject: 'math' },
        { code: SIBLING_CODE, learnerId: 'kid2', subject: 'math' },
      ],
    });

    const mine = await useCase.execute({ code: CODE });
    const theirs = await useCase.execute({ code: SIBLING_CODE });

    expect(mine.learner).toBe('kid1');
    expect(theirs.learner).toBe('kid2');
    expect(theirs.title).toBe(fixtureUnit(MEDIA_UNIT).title);
    // And still not one event written into either child's history.
    expect(appended).toEqual([]);
  });
});

describe('a subject behind a program', () => {
  /**
   * The program fan-out — `#collectProgramStatuses` and the `program` card —
   * is reached only when the catalog knows a program id, so a harness with
   * none never executes it at all. These two cases run both halves: the happy
   * one, and the degrade that must NOT become a rethrow (a launcher that
   * throws has to blank the button, not the whole card).
   */
  const languageProgram = (launcher) => ({
    assignmentSeed: [{ learnerId: 'kid1', units: ['language-daily'] }],
    codes: [{ code: CODE, learnerId: 'kid1', subject: 'language' }],
    programIds: ['language'],
    launchers: new Map([['language', launcher]]),
  });

  it('offers the program itself when its launcher answers', async () => {
    await build(languageProgram({
      status: async () => ({ doneToday: false, progressLabel: null, score: null }),
    }));

    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.subject).toBe('language');
    expect(card.actions).toMatchObject([
      { kind: 'program', label: `Open ${fixtureUnit('language-daily').title}`, target: 'language' },
      { kind: 'exit', label: 'Go back' },
    ]);
    expect(appended).toEqual([]);
  });

  it('degrades a throwing launcher to a card with words, never a thrown error', async () => {
    await build(languageProgram({
      status: async () => { throw new Error('language service down'); },
    }));

    const card = await useCase.execute({ code: CODE });

    // `{error: true}` -> `programUnavailable` -> a card, not a 500.
    expect(card.ok).toBe(true);
    expect(card.sentence).toBe('Tell a grown-up.');
    expect(card.actions).toMatchObject([{ kind: 'exit', label: 'Go back' }]);
    expect(appended).toEqual([]);
  });

  it('degrades the same way when no launcher is registered at all', async () => {
    await build({
      assignmentSeed: [{ learnerId: 'kid1', units: ['language-daily'] }],
      codes: [{ code: CODE, learnerId: 'kid1', subject: 'language' }],
      programIds: ['language'],
    });

    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.sentence).toBe('Tell a grown-up.');
    expect(card.actions).toMatchObject([{ kind: 'exit', label: 'Go back' }]);
  });
});

describe('a card with nothing to offer', () => {
  it('says so when the subject is already served today', async () => {
    // One unit of this subject finished today serves the whole subject for the
    // day — the same rule the scan path applies, so the card must agree.
    await completeUnit('kid1', MEDIA_UNIT, 'ses_done');
    appended.length = 0;

    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.sentence).toBe('You already did this today.');
    expect(card.actions).toMatchObject([{ kind: 'exit', label: 'Go back' }]);
    expect(appended).toEqual([]);
  });

  it('says why a locked subject is shut, and offers only the exit', async () => {
    // Only unit 2 assigned: unit 1 gates it, so the subject offers nothing.
    await build({ assignmentSeed: [{ learnerId: 'kid1', units: [WORKSHEET_UNIT] }] });
    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.sentence).toBe(`Finish “${fixtureUnit(MEDIA_UNIT).title}” first`);
    expect(card.actions).toMatchObject([{ kind: 'exit', label: 'Go back' }]);
    expect(appended).toEqual([]);
  });

  it('says tell a grown-up when the subject has nothing assigned at all', async () => {
    await build({ assignmentSeed: [] });
    const card = await useCase.execute({ code: CODE });

    expect(card.ok).toBe(true);
    expect(card.sentence).toBe('Tell a grown-up.');
    expect(card.actions).toMatchObject([{ kind: 'exit', label: 'Go back' }]);
  });
});
