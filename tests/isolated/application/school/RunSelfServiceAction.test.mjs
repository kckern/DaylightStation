/**
 * RunSelfServiceAction — the launch card's one button actually does something
 * (self-service access codes design, §4).
 *
 * `/resolve` (Task 6) reads and only reads. This is the other half: the child
 * has pressed the button, so a session may now be opened for real and a use
 * case may now be called. Three properties matter enough that a
 * mutation to the implementation must turn one of them red:
 *
 *   1. THE SYNTHETIC-ID GUARD. `ResolveAccessCode` reduces a sessionless entry
 *      from a synthetic `created` event whose id is the literal string
 *      `'synthetic:unopened'`. That string must never reach a use case; `/act`
 *      opens a real session first.
 *   2. THE DEBOUNCE SENTENCE. `IssueDocument` answers a re-print inside the
 *      cooldown with `status: 'debounced'`, `document: null` and `message: ''`
 *      — silence designed for thermal slips. On a screen the silence is a
 *      child tapping a button and nothing happening, so `/act` supplies words.
 *   3. THE ACTION-NOT-ON-CARD REFUSAL. The card is recomputed on every act, so
 *      a stale button (a second panel, a slow tap) is refused — with words.
 *
 * NEVER A DEAD END: every case below asserts a non-empty sentence, including
 * the ones where a use case throws.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RunSelfServiceAction } from '#apps/school/usecases/RunSelfServiceAction.mjs';
import { ResolveAccessCode } from '#apps/school/usecases/ResolveAccessCode.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeAssignmentStore, FakeTokenRegistry,
  fakeClock, seededRng, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, WORKSHEET_UNIT, MEDIA_BANK_ID,
} from '#testlib/school/lifecycleFixtures.mjs';

const CODE = '481920';
/** The next 4am study-day rollover after the fake clock's 2026-07-27T09:00Z. */
const TOMORROW = '2026-07-28T04:00:00.000Z';
const MEDIA_SURFACE = Object.freeze({ id: 'livingroom-tv', label: 'living room' });
const LAUNCH_SURFACE = 'garage-fitness';
const PROGRAM_ID = 'lang-app';

/** The id `ResolveAccessCode` reduces a sessionless entry against. Never a session. */
const SYNTHETIC = 'synthetic:unopened';

let clock, sessions, tokens, assignments, useCase, card, spies;

/** A recording stand-in: every call's arguments, and a scripted reply. */
const spy = (reply) => {
  const fn = async (args) => {
    fn.calls.push(args);
    return typeof reply === 'function' ? reply(args) : reply;
  };
  fn.calls = [];
  return fn;
};

const build = ({
  assignmentSeed = [{ learnerId: 'kid1', courses: ['math-fractions'] }],
  units,
  subject = 'math',
  canIssueBank = () => false,
  issue = { status: 'issued', artifactId: 'art_1', pageCount: 1, message: 'Printing your sheet.', tokens: {} },
  media = {
    status: 'dispatched', dispatchId: 'dsp_1', target: 'livingroom-tv',
    message: 'Starting on living room TV.', document: null,
  },
  remediation = {
    status: 'opened', newSessionId: 'ses_retry', variant: 1,
    message: 'Printing a fresh sheet to try again.', document: null,
  },
  donow = { decision: 'dispatched', message: 'Starting the garage bike now.' },
  program = null,
  wire = {},
} = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({
    units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests(),
  });
  const curriculum = new CurriculumAccess({
    catalog,
    bankIds: () => BANK_IDS,
    programIds: () => [PROGRAM_ID],
    // A launch unit only validates when the catalog's surface registry knows
    // the surface it names — the same always-valid stand-in
    // `resolveSubjectNext.test.mjs` uses.
    surfaceValidators: () => new Map([[LAUNCH_SURFACE, () => []]]),
    clock: clock.epoch,
    logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  assignments = new FakeAssignmentStore(assignmentSeed);
  tokens = new FakeTokenRegistry({ now: clock.iso });

  return (async () => {
    const record = mintToken({
      tokenClass: 'subject_next',
      subject: { learnerId: 'kid1', subject },
      at: clock.iso(),
      rng: seededRng(),
      expiresAt: new Date(clock.epoch() + 168 * 3_600_000).toISOString(),
      accessCode: CODE,
      accessCodeExpiresAt: TOMORROW,
    });
    await tokens.put(record);

    spies = {
      issueDocument: { execute: spy(issue) },
      dispatchMedia: { execute: spy(media) },
      openRemediation: { execute: spy(remediation) },
      donow: { dispatch: spy(donow) },
      closeSessionOutcome: { execute: spy({ status: 'closed' }) },
    };

    // A program launcher declares WHERE it sends a child (`surface`). That is
    // the only structural answer to "does this open here, or somewhere else" —
    // `locationHint` is display wording and must never be routed on.
    let launchers = new Map();
    if (program) {
      spies.launcher = { launch: spy(program.launch ?? { decision: 'dispatched', message: 'Starting the garage bike now.' }) };
      const entry = {
        id: program.id ?? PROGRAM_ID,
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        launch: spies.launcher.launch,
      };
      // `undefined` means a launcher that declares no surface at all — the
      // legacy/third-party shape, which must still not claim to open here.
      if (program.surface !== undefined) Object.defineProperty(entry, 'surface', { get: () => program.surface });
      launchers = new Map([[program.id ?? PROGRAM_ID, entry]]);
    }
    // A launcher missing from the CARD's map degrades the card itself (the
    // program resolves `unavailable` and no button is offered), so that is not
    // the case `#program`'s no-launcher branch guards. The case it guards is
    // the composition bug the reviewer found: the card has the launcher, the
    // action runner was never handed it. Hence two maps.
    const runnerLaunchers = program?.unregistered ? new Map() : launchers;

    card = new ResolveAccessCode({
      tokens,
      curriculum,
      assignments,
      sessions,
      launchers,
      issueDocument: { canIssueBank },
      selfService: { mediaSurface: MEDIA_SURFACE },
      clock: clock.now,
      logger: silentLogger,
    });

    useCase = new RunSelfServiceAction({
      resolveAccessCode: card,
      sessions,
      launchers: runnerLaunchers,
      newSessionId: sequentialIds('ses_new_'),
      clock: clock.now,
      logger: silentLogger,
      ...spies,
      ...wire,
    });
  })();
};

/** Every argument every spy was handed, flattened — for "nothing was called". */
const allCalls = () => Object.values(spies).flatMap((port) => Object.values(port)
  .flatMap((fn) => fn.calls));

/** The session ids handed to any use case on this run. */
const sessionIdsSeen = () => allCalls().map((args) => args?.sessionId ?? args?.ref).filter(Boolean);

/** Unit 1 with its media stripped: a bank-only unit, the print-or-screen fork. */
const bankOnly = () => rawUnits({ [MEDIA_UNIT]: { media: undefined } });

/** Unit 2 turned into a standalone `launch:` unit, same derivation as resolveSubjectNext's. */
const launchUnit = () => ({
  units: rawUnits({
    [WORKSHEET_UNIT]: {
      launch: { surface: LAUNCH_SURFACE, episodeId: 'plex:900', labelHint: 'go to the garage' },
      courseId: undefined, sequence: undefined, passing: undefined,
      retry: undefined, reward: undefined, review: undefined, document: undefined,
    },
  }),
  assignmentSeed: [{ learnerId: 'kid1', units: [WORKSHEET_UNIT] }],
});

/** Unit 2 turned into a standalone `program:` unit on the language shelf. */
const programUnit = (program = { surface: 'portal' }) => ({
  units: rawUnits({
    [WORKSHEET_UNIT]: {
      subject: 'language', program: PROGRAM_ID, cadence: 'once',
      courseId: undefined, sequence: undefined, passing: undefined,
      retry: undefined, reward: undefined, review: undefined, document: undefined,
    },
  }),
  assignmentSeed: [{ learnerId: 'kid1', units: [WORKSHEET_UNIT] }],
  subject: 'language',
  program,
});

beforeEach(async () => { await build(); });

// ---------------------------------------------------------------------------
// 1. the synthetic-id guard — the point of the two-endpoint split
// ---------------------------------------------------------------------------

describe('opening a session for real', () => {
  it('opens one before calling a use case when the entry had none', async () => {
    // The card resolved against a SYNTHETIC created state; acting on it must
    // append a real `created` event and hand the use case the real id.
    const before = sessions.ids();
    expect(before).toEqual([]);

    const result = await useCase.execute({ code: CODE, action: 'play' });

    expect(result.outcome).toBe('done');
    const opened = sessions.ids();
    expect(opened).toEqual(['ses_new_1']);
    expect(sessions.types('ses_new_1')).toEqual(['created']);

    expect(spies.dispatchMedia.execute.calls).toHaveLength(1);
    expect(spies.dispatchMedia.execute.calls[0].sessionId).toBe('ses_new_1');
    expect(result.sessionId).toBe('ses_new_1');
  });

  it('never lets the synthetic id reach a use case', async () => {
    await useCase.execute({ code: CODE, action: 'play' });
    const seen = sessionIdsSeen();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(SYNTHETIC);
    for (const id of seen) expect(id).not.toMatch(/synthetic/);
  });

  it('reuses the session the plan entry already carries, opening no second one', async () => {
    for (const event of [
      { type: 'created', learnerId: 'kid1', unitId: MEDIA_UNIT },
      { type: 'media_dispatched', dispatchId: 'dsp_0', target: 'livingroom-tv', contentId: 'plex:1' },
      { type: 'media_completed', verified: true },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent('ses_open', { ...event, sessionId: 'ses_open', at: clock.iso() });
    }

    // media_completed on a media+bank unit offers the screen, not the video.
    const result = await useCase.execute({ code: CODE, action: 'screen' });

    expect(result.outcome).toBe('mount');
    expect(result.sessionId).toBe('ses_open');
    expect(sessions.ids()).toEqual(['ses_open']);
    expect(sessions.types('ses_open')).toEqual(['created', 'media_dispatched', 'media_completed']);
  });

  it('opens NOTHING for an action that needs no session', async () => {
    const result = await useCase.execute({ code: CODE, action: 'exit' });
    expect(result.outcome).toBe('done');
    expect(sessions.ids()).toEqual([]);
    expect(allCalls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. the debounce sentence — silence designed for paper, rendered as words
// ---------------------------------------------------------------------------

describe('a print inside the cooldown window', () => {
  const DEBOUNCED = {
    status: 'debounced', sessionId: 'ses_new_1', artifactId: 'art_1',
    pageCount: null, tokens: {}, document: null, message: '',
  };

  it('answers with a sentence, never IssueDocument\'s empty message', async () => {
    await build({ units: bankOnly(), canIssueBank: () => true, issue: DEBOUNCED });

    const result = await useCase.execute({ code: CODE, action: 'print' });

    expect(spies.issueDocument.execute.calls).toHaveLength(1);
    expect(result.outcome).toBe('debounced');
    expect(result.sentence).toBe("It's already on its way — give it a minute.");
    expect(result.sentence).not.toBe('');
    expect(result.sentence.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. an action that is not on the card — refused, with words
// ---------------------------------------------------------------------------

describe('an action the card is not offering', () => {
  it('refuses a print on a card that offers only the video', async () => {
    // The default fixture: unit 1 carries media, so the card offers `play`.
    const offered = (await card.execute({ code: CODE })).actions.map((a) => a.kind);
    expect(offered).toEqual(['play', 'exit']);

    const result = await useCase.execute({ code: CODE, action: 'print' });

    expect(result.outcome).toBe('refused');
    expect(typeof result.sentence).toBe('string');
    expect(result.sentence.length).toBeGreaterThan(0);
    // Refused means refused: no use case ran and no session was opened.
    expect(allCalls()).toEqual([]);
    expect(sessions.ids()).toEqual([]);
  });

  it('refuses an action nobody offers at all', async () => {
    const result = await useCase.execute({ code: CODE, action: 'detonate' });
    expect(result.outcome).toBe('refused');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(allCalls()).toEqual([]);
  });

  it('refuses a missing action', async () => {
    const result = await useCase.execute({ code: CODE });
    expect(result.outcome).toBe('refused');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(allCalls()).toEqual([]);
  });

  it('refuses every action on a card that offers only the exit', async () => {
    // Nothing assigned: `Tell a grown-up.` and one button.
    await build({ assignmentSeed: [] });
    const result = await useCase.execute({ code: CODE, action: 'print' });
    expect(result.outcome).toBe('refused');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(allCalls()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// each action kind reaches the right use case with the right arguments
// ---------------------------------------------------------------------------

describe('print', () => {
  it('calls IssueDocument against the real session and reports its own words', async () => {
    await build({ units: bankOnly(), canIssueBank: () => true });

    const result = await useCase.execute({ code: CODE, action: 'print' });

    expect(spies.issueDocument.execute.calls).toEqual([{ sessionId: 'ses_new_1' }]);
    expect(result).toMatchObject({
      outcome: 'done', action: 'print', sessionId: 'ses_new_1',
      sentence: 'Printing your sheet.',
    });
    expect(result.effect).toMatchObject({ status: 'issued', artifactId: 'art_1' });
    // PRINTING NEVER RETIRES WORK (offerSession.mjs: only an OMR/grade event
    // does). A close here would retire the worksheet the instant it printed,
    // and the child's "No, it didn't print" reprint would start refusing —
    // which is exactly what `IssueDocument`'s ISSUABLE set exists to allow.
    expect(spies.closeSessionOutcome.execute.calls).toEqual([]);
  });

  it('rewords a scanner instruction for a keypad', async () => {
    // IssueDocument's own already_done copy says "Scan your card to see what
    // is next" — there is no card to scan at the panel.
    await build({
      units: bankOnly(),
      canIssueBank: () => true,
      issue: {
        status: 'already_done', artifactId: 'art_1', pageCount: null, tokens: {},
        message: 'That sheet is already done with. Scan your card to see what is next.',
        document: {},
      },
    });

    const result = await useCase.execute({ code: CODE, action: 'print' });

    expect(result.outcome).toBe('refused');
    expect(result.sentence).not.toMatch(/scan/i);
    expect(result.sentence.length).toBeGreaterThan(0);
  });
});

describe('play', () => {
  it('calls DispatchMedia at the configured surface', async () => {
    const result = await useCase.execute({ code: CODE, action: 'play' });

    expect(spies.dispatchMedia.execute.calls).toEqual([
      { sessionId: 'ses_new_1', target: 'livingroom-tv' },
    ]);
    expect(result).toMatchObject({
      outcome: 'done', action: 'play', sentence: 'Starting on living room TV.',
    });
    expect(spies.issueDocument.execute.calls).toEqual([]);
  });

  it('rewords the already-watched refusal away from the scanner', async () => {
    await build({
      media: {
        status: 'already_done', dispatchId: null, target: null,
        message: 'You already watched this one. Scan your card to see what is next.',
        document: {},
      },
    });
    const result = await useCase.execute({ code: CODE, action: 'play' });
    expect(result.outcome).toBe('refused');
    expect(result.sentence).not.toMatch(/scan/i);
    expect(result.sentence.length).toBeGreaterThan(0);
  });
});

describe('retry', () => {
  /** A worksheet unit graded needs_remediation — the one state that offers a retry. */
  const failedToday = async () => {
    const events = [
      { type: 'created', learnerId: 'kid1', unitId: MEDIA_UNIT },
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 20 },
      { type: 'outcome_recorded', outcomeId: 'out:ses_failed', result: 'needs_remediation' },
    ];
    for (const event of events) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent('ses_failed', { ...event, sessionId: 'ses_failed', at: clock.iso() });
    }
  };

  it('opens a FRESH session through OpenRemediation, then prints against that one', async () => {
    await build({ units: bankOnly(), canIssueBank: () => true });
    await failedToday();
    expect((await card.execute({ code: CODE })).actions[0].kind).toBe('retry');

    const result = await useCase.execute({ code: CODE, action: 'retry' });

    // The remediation is opened against the GRADED session...
    expect(spies.openRemediation.execute.calls).toEqual([{ sessionId: 'ses_failed' }]);
    // ...and the sheet is printed against the NEW one, never the graded one.
    expect(spies.issueDocument.execute.calls).toEqual([{ sessionId: 'ses_retry' }]);
    expect(result).toMatchObject({
      outcome: 'done', action: 'retry', sessionId: 'ses_retry',
      sentence: 'Printing a fresh sheet to try again.',
    });
    expect(result.effect).toMatchObject({ remediationOf: 'ses_failed', variant: 1 });
    // Same rule on the retry's print: the fresh sheet is not retired by
    // coming out of the printer either.
    expect(spies.closeSessionOutcome.execute.calls).toEqual([]);
  });

  it('says so, and prints nothing, when there is nothing to try again', async () => {
    await build({
      units: bankOnly(),
      canIssueBank: () => true,
      remediation: {
        status: 'unavailable', newSessionId: null, variant: null,
        message: 'There is nothing to try again right now.', document: {},
      },
    });
    await failedToday();

    const result = await useCase.execute({ code: CODE, action: 'retry' });

    expect(result.outcome).toBe('refused');
    expect(result.sentence).toBe('There is nothing to try again right now.');
    expect(spies.issueDocument.execute.calls).toEqual([]);
  });
});

describe('launch', () => {
  it('dispatches through DoNow, records it, and honour-closes the session', async () => {
    await build(launchUnit());

    const result = await useCase.execute({ code: CODE, action: 'launch' });

    expect(spies.donow.dispatch.calls).toHaveLength(1);
    expect(spies.donow.dispatch.calls[0]).toMatchObject({
      surface: LAUNCH_SURFACE,
      action: { episodeId: 'plex:900', labelHint: 'go to the garage' },
      learnerId: 'kid1',
      ref: 'ses_new_1',
    });
    // The surface is the DESTINATION, not part of the action payload.
    expect(spies.donow.dispatch.calls[0].action.surface).toBeUndefined();

    expect(sessions.types('ses_new_1')).toEqual(['created', 'launch_dispatched']);
    expect(spies.closeSessionOutcome.execute.calls).toEqual([
      { sessionId: 'ses_new_1', honorClose: true },
    ]);
    // DoNow's own wording, verbatim.
    expect(result).toMatchObject({ outcome: 'done', sentence: 'Starting the garage bike now.' });
  });

  it('shows a pending grown-up approval verbatim, and closes nothing', async () => {
    await build({
      ...launchUnit(),
      donow: {
        decision: 'pending_approval', approvalId: 'dnr_1',
        message: 'The garage bike is busy — we asked a grown-up.',
      },
    });

    const result = await useCase.execute({ code: CODE, action: 'launch' });

    expect(result.outcome).toBe('pending');
    expect(result.sentence).toBe('The garage bike is busy — we asked a grown-up.');
    expect(sessions.types('ses_new_1')).toEqual(['created']);
    expect(spies.closeSessionOutcome.execute.calls).toEqual([]);
  });

  it('shows a denial verbatim, and records no dispatch', async () => {
    await build({
      ...launchUnit(),
      donow: { decision: 'denied', message: 'The garage bike is busy right now.' },
    });

    const result = await useCase.execute({ code: CODE, action: 'launch' });

    expect(result.outcome).toBe('refused');
    expect(result.sentence).toBe('The garage bike is busy right now.');
    expect(sessions.types('ses_new_1')).toEqual(['created']);
    expect(spies.closeSessionOutcome.execute.calls).toEqual([]);
  });

  it('says ask a grown-up rather than phantom-dispatching when DoNow is unwired', async () => {
    await build({ ...launchUnit(), wire: { donow: null } });

    const result = await useCase.execute({ code: CODE, action: 'launch' });

    expect(result.outcome).toBe('failed');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(sessions.types('ses_new_1')).toEqual(['created']);
  });
});

describe('screen and program', () => {
  it('hands the panel what it needs to mount the quiz, printing nothing', async () => {
    await build({ units: bankOnly(), canIssueBank: () => false });

    const result = await useCase.execute({ code: CODE, action: 'screen' });

    expect(result.outcome).toBe('mount');
    expect(result.sessionId).toBe('ses_new_1');
    expect(result.effect).toMatchObject({
      kind: 'bank', bankId: MEDIA_BANK_ID, unitId: MEDIA_UNIT, learnerId: 'kid1',
    });
    expect(result.sentence.length).toBeGreaterThan(0);
    // Nothing printed, nothing dispatched — the panel is the screen.
    expect(allCalls()).toEqual([]);
  });

  it('hands the panel a PORTAL program to mount, opening no session', async () => {
    // The Portal IS this panel, so a Portal-hosted program really does open
    // here — the one case where "Opening it here on the screen." is true.
    await build(programUnit({ surface: 'portal' }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(result.outcome).toBe('mount');
    expect(result.effect).toMatchObject({ kind: 'program', programId: PROGRAM_ID });
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(sessions.ids()).toEqual([]);
    // Mounted here, so nothing was dispatched anywhere.
    expect(allCalls()).toEqual([]);
  });

  it('DISPATCHES a surface program instead of claiming it opens here', async () => {
    // `pe-daily` dispatches to `garage-fitness`. Answering `mount` would tell
    // a child the work is opening on the screen in front of them while
    // nothing happens anywhere — a dead end wearing the words of a success.
    await build(programUnit({
      surface: 'garage-fitness',
      launch: { decision: 'dispatched', message: 'Starting the garage bike now.' },
    }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(spies.launcher.launch.calls).toEqual([{ userId: 'kid1' }]);
    expect(result.outcome).not.toBe('mount');
    expect(result.outcome).toBe('done');
    // DoNow's own wording, verbatim — it names the real surface.
    expect(result.sentence).toBe('Starting the garage bike now.');
    expect(result.sentence).not.toMatch(/here on the screen/);
    expect(result.sentence).not.toMatch(/on the screen/);
    expect(result.effect).toMatchObject({ decision: 'dispatched', surface: 'garage-fitness' });
    // Nothing for a panel to mount, so nothing that names a mountable target.
    expect(result.effect.kind).toBeUndefined();
    expect(sessions.ids()).toEqual([]);
  });

  it('shows a busy surface program\'s pending approval verbatim', async () => {
    await build(programUnit({
      surface: 'garage-fitness',
      launch: {
        decision: 'pending_approval', approvalId: 'dnr_9',
        message: 'The garage bike is busy — we asked a grown-up.',
      },
    }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(spies.launcher.launch.calls).toHaveLength(1);
    expect(result.outcome).toBe('pending');
    expect(result.sentence).toBe('The garage bike is busy — we asked a grown-up.');
    expect(result.outcome).not.toBe('mount');
  });

  it('dispatches rather than mounts a launcher that declares no surface', async () => {
    // The fail-safe direction: a launcher that never said where it sends a
    // child must not have "it opens here" assumed on its behalf.
    await build(programUnit({ surface: undefined }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(spies.launcher.launch.calls).toHaveLength(1);
    expect(result.outcome).not.toBe('mount');
    expect(result.sentence).not.toMatch(/on the screen/);
  });

  it('says ask a grown-up when the runner was never handed the launcher', async () => {
    // The exact composition bug this fix came from: `RunSelfServiceAction`
    // with no `launchers` cannot tell a Portal program from a garage one.
    // It must say so, not claim the work opened.
    await build(programUnit({ surface: 'garage-fitness', unregistered: true }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(result.outcome).not.toBe('mount');
    expect(result.outcome).toBe('failed');
    expect(result.sentence).toBe('Ask a grown-up to set this up.');
    expect(result.sentence).not.toMatch(/on the screen/);
  });

  it('says so, rather than claiming success, when a launcher throws', async () => {
    await build(programUnit({
      surface: 'garage-fitness',
      launch: () => { throw new Error('donow unreachable'); },
    }));

    const result = await useCase.execute({ code: CODE, action: 'program' });

    expect(spies.launcher.launch.calls).toHaveLength(1);
    expect(result.outcome).not.toBe('mount');
    expect(result.outcome).toBe('failed');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(result.sentence).not.toMatch(/on the screen/);
  });
});

// ---------------------------------------------------------------------------
// never a dead end
// ---------------------------------------------------------------------------

describe('never a dead end', () => {
  it('answers a code that was never minted with the card\'s own sentence', async () => {
    const result = await useCase.execute({ code: '000000', action: 'print' });
    expect(result.outcome).toBe('refused');
    expect(result.sentence).toBe('Try again.');
    expect(allCalls()).toEqual([]);
    expect(sessions.ids()).toEqual([]);
  });

  it('never throws on junk', async () => {
    for (const junk of [undefined, null, '', 'abcdef', 12345, {}, []]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await useCase.execute({ code: junk, action: 'print' });
      expect(result.outcome).toBe('refused');
      expect(result.sentence.length).toBeGreaterThan(0);
    }
    expect(sessions.ids()).toEqual([]);
  });

  it('answers with words when a use case throws', async () => {
    await build({
      units: bankOnly(),
      canIssueBank: () => true,
      issue: () => { throw new Error('printer daemon exploded'); },
    });

    const result = await useCase.execute({ code: CODE, action: 'print' });

    expect(result.outcome).toBe('failed');
    expect(typeof result.sentence).toBe('string');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(result.sentence).toMatch(/grown-up/);
  });

  it('answers with words when the card itself cannot be built', async () => {
    const broken = new RunSelfServiceAction({
      resolveAccessCode: { resolve: async () => { throw new Error('catalog on fire'); } },
      sessions,
      newSessionId: sequentialIds('ses_new_'),
      clock: clock.now,
      logger: silentLogger,
    });

    const result = await broken.execute({ code: CODE, action: 'print' });

    expect(result.outcome).toBe('failed');
    expect(result.sentence.length).toBeGreaterThan(0);
  });

  it('answers with words when the session cannot be opened', async () => {
    await build({
      wire: {
        sessions: {
          listForLearner: (id) => sessions.listForLearner(id),
          readEvents: (id) => sessions.readEvents(id),
          appendEvent: async () => { throw new Error('disk full'); },
        },
      },
    });

    const result = await useCase.execute({ code: CODE, action: 'play' });

    expect(result.outcome).toBe('failed');
    expect(result.sentence.length).toBeGreaterThan(0);
    expect(spies.dispatchMedia.execute.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// the response shape Task 8 consumes
// ---------------------------------------------------------------------------

describe('the response shape', () => {
  /**
   * The panel's play/launch branch shows whatever sentence arrives, with no
   * fallback of its own — so a use case that answers with a blank message
   * would put an empty card in front of a child. `execute` enforces the
   * non-empty sentence itself rather than trusting every branch to.
   */
  it('supplies words when a use case answers with a blank sentence', async () => {
    await build({
      media: {
        status: 'dispatched', dispatchId: 'dsp_1', target: 'livingroom-tv',
        message: '   ', document: null,
      },
    });

    const result = await useCase.execute({ code: CODE, action: 'play' });

    expect(spies.dispatchMedia.execute.calls).toHaveLength(1);
    expect(result.sentence.trim().length).toBeGreaterThan(0);
    expect(result.sentence).not.toBe('   ');
  });

  it('supplies words when DoNow answers with a blank message', async () => {
    await build({ ...launchUnit(), donow: { decision: 'dispatched', message: '' } });

    const result = await useCase.execute({ code: CODE, action: 'launch' });

    expect(spies.donow.dispatch.calls).toHaveLength(1);
    expect(result.outcome).toBe('done');
    expect(result.sentence.trim().length).toBeGreaterThan(0);
  });

  it('always carries outcome, sentence, action, sessionId and effect', async () => {
    const runs = [
      await useCase.execute({ code: CODE, action: 'play' }),
      await useCase.execute({ code: CODE, action: 'exit' }),
      await useCase.execute({ code: '000000', action: 'play' }),
    ];
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      expect(Object.keys(run).sort()).toEqual(['action', 'effect', 'outcome', 'sentence', 'sessionId']);
      expect(typeof run.outcome).toBe('string');
      expect(typeof run.sentence).toBe('string');
      expect(run.sentence.length).toBeGreaterThan(0);
    }
  });
});
