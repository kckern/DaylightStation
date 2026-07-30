import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
import { ResolveSubjectNext } from '#apps/school/usecases/ResolveSubjectNext.mjs';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { DispatchMedia } from '#apps/school/usecases/DispatchMedia.mjs';
import { OpenRemediation } from '#apps/school/usecases/OpenRemediation.mjs';
import { CloseSessionOutcome } from '#apps/school/usecases/CloseSessionOutcome.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { ReceiptPrinting } from '#apps/school/ReceiptPrinting.mjs';
import { mintToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore,
  FakeFormMapStore, FakeDocumentRenderer, FakeReceiptRenderer, FakeLaserPrinter,
  FakeReceiptPrinter, FakePlayback, FakeEconomy,
  fakeClock, fakeGrownUps, seededRng, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, WORKSHEET_UNIT, MIXED_UNIT, MEDIA_BANK_ID,
} from '#testlib/school/lifecycleFixtures.mjs';

const TARGETS = [{ id: 'living-room-tv', label: 'the TV', child_selectable: true }];
// Used only by the program-path subject_next tests, mirroring buildAgenda.test.mjs's fixture.
const PROGRAM_ID = 'lang-app';
// Used only by the launch-unit tests below.
const LAUNCH_SURFACE = 'garage-fitness';

let clock, rng, sessions, tokens, thermal, laser, playback, resolve, agenda, close, portal, donow;

const build = ({
  assignment = { learnerId: 'kid1', courses: ['math-fractions'] },
  units, launchers = new Map(), portalLaunch = null,
  // A launch unit validates only if the catalog's surface registry knows the
  // surface it names (spec §6) — always-valid stand-in, mirroring
  // resolveSubjectNext.test.mjs's identical fixture concern.
  surfaceValidators = () => new Map([[LAUNCH_SURFACE, () => []]]),
  donowDispatch = null,
  wireDonow = true,
} = {}) => {
  clock = fakeClock();
  rng = seededRng(21);
  const catalog = new FakeCatalog({ units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({
    catalog, bankIds: () => BANK_IDS, programIds: () => [PROGRAM_ID], surfaceValidators, clock: clock.epoch, logger: silentLogger,
  });
  sessions = new FakeSessionRepository();
  tokens = new FakeTokenRegistry();
  thermal = new FakeReceiptPrinter();
  laser = new FakeLaserPrinter();
  playback = new FakePlayback();
  const formMaps = new FakeFormMapStore();
  const assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  const receipts = new ReceiptPrinting({ renderer: new FakeReceiptRenderer(), printer: thermal, logger: silentLogger });

  agenda = new BuildAgenda({
    curriculum, assignments, sessions, tokens, launchers,
    clock: clock.now, rng, newSessionId: sequentialIds(), logger: silentLogger,
  });
  let artifactSeq = 0;
  const issueDocument = new IssueDocument({
    curriculum, sessions, tokens, renderer: new FakeDocumentRenderer(), printer: laser, formMaps,
    clock: clock.now, rng, newArtifactId: () => `art_${++artifactSeq}`, logger: silentLogger,
  });
  const dispatchMedia = new DispatchMedia({ curriculum, sessions, playback, targets: TARGETS, clock: clock.now, logger: silentLogger });
  const openRemediation = new OpenRemediation({ curriculum, sessions, clock: clock.now, newSessionId: sequentialIds('ses_r'), logger: silentLogger });
  close = new CloseSessionOutcome({
    curriculum, sessions, tokens, assignments, economy: new FakeEconomy(), economyEnabled: true,
    grownUps: fakeGrownUps(clock), clock: clock.now, rng, logger: silentLogger,
  });
  const card = new ResolvePersonalCard({
    buildAgenda: agenda, receipts,
    roster: { displayName: (id) => (id === 'kid1' ? 'Sam' : null) },
    logger: silentLogger,
  });
  const resolveSubjectNext = new ResolveSubjectNext({
    curriculum, assignments, sessions, launchers,
    clock: clock.now, newSessionId: sequentialIds('ses_s'), logger: silentLogger,
  });
  // Null unless a test needs to assert on the broadcast — `#onScreen`'s
  // `this.#portal?.launch` no-ops without one, same as an unwired household.
  portal = portalLaunch ? { launch: portalLaunch } : null;
  // Null when a test asks for the unwired ("optional-degrading") case; wired
  // by default with a fake that dispatches immediately, so a test wanting
  // pending/denied/failed passes its own `donowDispatch` mock.
  donow = wireDonow
    ? { dispatch: donowDispatch || vi.fn(async () => ({ decision: 'dispatched', message: 'Starting the garage fitness kiosk now.' })) }
    : null;
  resolve = new ResolveScanAction({
    tokens, sessions, curriculum, resolvePersonalCard: card, issueDocument,
    dispatchMedia, openRemediation, receipts,
    resolveSubjectNext, portal, launchers, donow, closeSessionOutcome: close,
    clock: clock.now, logger: silentLogger,
  });
};

/** Turn WORKSHEET_UNIT into a standalone program unit — same derivation as
 * buildAgenda.test.mjs's `withLanguageProgram`. */
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

/** Turn WORKSHEET_UNIT into a standalone launch unit — same derivation
 * pattern as `withLanguageProgram` above. */
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

const cardToken = async (learnerId = 'kid1') => {
  const record = mintToken({ tokenClass: 'identify', subject: { learnerId }, at: clock.iso(), rng });
  await tokens.put(record);
  return record.token;
};

beforeEach(() => build());

describe('the personal card', () => {
  it('prints the agenda, by name', async () => {
    const result = await resolve.execute({ code: await cardToken(), device: 'kitchen-scanner' });
    expect(result).toMatchObject({ status: 'agenda_printed', tokenClass: 'identify', physical: 'receipt', printed: true });
    // The name arrives via the standard header, which prints uppercased.
    expect(thermal.lastTranscript()).toContain('SAM');
  });

  it('re-scanning reprints and NEVER opens a second session', async () => {
    const code = await cardToken();
    await resolve.execute({ code });
    await resolve.execute({ code });
    expect(thermal.jobs).toHaveLength(2);
    expect(sessions.ids()).toEqual(['ses_1']);
  });

  it('reports a refusing printer rather than pretending', async () => {
    thermal.setFault('offline');
    const result = await resolve.execute({ code: await cardToken() });
    expect(result).toMatchObject({ status: 'print_failed', printed: false });
  });
});

describe('unknown and stale tickets', () => {
  it('prints an explanation slip for a ticket nobody minted', async () => {
    const result = await resolve.execute({ code: 'sch:NOTATICKET' });
    expect(result).toMatchObject({ status: 'unknown', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('We do not know that ticket');
  });

  it('prints a slip for an expired ticket', async () => {
    // BuildAgenda's own offers now carry a sessionless `subject_next` ticket
    // (Task 10) — a per-unit ticket's expiry is exercised directly here,
    // decoupled from however the agenda happens to mint its own tokens.
    await sessions.appendEvent('ses_v', { type: 'created', at: clock.iso(), sessionId: 'ses_v', learnerId: 'kid1', unitId: MEDIA_UNIT });
    const record = mintToken({
      tokenClass: 'select_unit', subject: { sessionId: 'ses_v' }, at: clock.iso(), rng,
      expiresAt: new Date(Date.parse(clock.iso()) + 48 * 3_600_000).toISOString(),
    });
    await tokens.put(record);
    clock.advanceHours(72);
    const result = await resolve.execute({ code: record.token });
    expect(result.status).toBe('expired');
    expect(thermal.lastTranscript()).toContain('out of date');
  });

  it('prints a slip for a revoked card, never an error', async () => {
    const code = await cardToken();
    await tokens.revoke(code, { at: clock.iso() });
    const result = await resolve.execute({ code });
    expect(result.status).toBe('expired');
    expect(result.printed).toBe(true);
  });

  it('says already_done — never an error — once the work has moved on', async () => {
    await sessions.appendEvent('ses_v', { type: 'created', at: clock.iso(), sessionId: 'ses_v', learnerId: 'kid1', unitId: MEDIA_UNIT });
    const record = mintToken({ tokenClass: 'select_unit', subject: { sessionId: 'ses_v' }, at: clock.iso(), rng });
    await tokens.put(record);
    await resolve.execute({ code: record.token }); // dispatches the video
    const again = await resolve.execute({ code: record.token });
    expect(again.status).toBe('already_done');
    expect(again.printed).toBe(true);
    expect(playback.dispatches).toHaveLength(1);
  });

  it('ignores a code that is not ours and prints nothing', async () => {
    const result = await resolve.execute({ code: '012345678905' });
    expect(result).toMatchObject({ status: 'not_school', physical: 'none', printed: false });
    expect(thermal.jobs).toEqual([]);
  });
});

describe('starting a unit', () => {
  it('a video unit dispatches and tells the child what happens next', async () => {
    await sessions.appendEvent('ses_v', { type: 'created', at: clock.iso(), sessionId: 'ses_v', learnerId: 'kid1', unitId: MEDIA_UNIT });
    const record = mintToken({ tokenClass: 'select_unit', subject: { sessionId: 'ses_v' }, at: clock.iso(), rng });
    await tokens.put(record);
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'dispatched', tokenClass: 'media_action', physical: 'receipt' });
    expect(playback.dispatches[0]).toMatchObject({ contentId: 'plex:481203', target: 'living-room-tv' });
    expect(thermal.lastTranscript()).toContain('scan your card for the questions');
  });

  it('a worksheet unit prints the sheet itself, not a receipt about it', async () => {
    await sessions.appendEvent('ses_w', { type: 'created', at: clock.iso(), sessionId: 'ses_w', learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    const record = mintToken({ tokenClass: 'select_unit', subject: { sessionId: 'ses_w' }, at: clock.iso(), rng });
    await tokens.put(record);
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'issued', physical: 'worksheet', printed: true });
    expect(laser.jobs).toHaveLength(1);
    expect(thermal.jobs).toEqual([]);
  });
});

describe('a launch unit (Task 12, spec §6/§6.2)', () => {
  const launchSession = async () => {
    const sid = 'ses_l';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    const record = mintToken({ tokenClass: 'select_unit', subject: { sessionId: sid }, at: clock.iso(), rng });
    await tokens.put(record);
    return { sid, record };
  };

  it('dispatches through DoNow, honor-closes the session in the same round trip, and prints "off you go"', async () => {
    build(withLaunchUnit());
    const { sid, record } = await launchSession();
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'dispatched', tokenClass: 'select_unit', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('Starting — off you go');
    expect(donow.dispatch).toHaveBeenCalledWith({
      surface: LAUNCH_SURFACE, action: { episodeId: 'plex:999' }, learnerId: 'kid1',
      requestedBy: 'school-scan', ref: sid,
    });
    // The scan itself closed it (honorClose, no signedOffBy) — never left
    // dangling at launch_dispatched waiting on something else to finish it.
    expect(sessions.types(sid)).toEqual(expect.arrayContaining(['launch_dispatched', 'outcome_recorded']));
    expect(sessions.derive(sid).terminal).toBe(true);
  });

  it('a busy surface pends, printing "we asked a grown-up" and never touching the session', async () => {
    build({
      ...withLaunchUnit(),
      donowDispatch: vi.fn(async () => ({
        decision: 'pending_approval', approvalId: 'dnr_1',
        message: 'The garage fitness kiosk is busy — we asked a grown-up.',
      })),
    });
    const { sid, record } = await launchSession();
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'pending_approval', tokenClass: 'select_unit', printed: true });
    expect(thermal.lastTranscript()).toContain('is busy — we asked a grown-up');
    // No session event yet — the approval gap (spec §6): nothing happened.
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
    expect(sessions.derive(sid).state).toBe('created');
  });

  it('denied/failed prints the DoNow remedy line, never a dead end', async () => {
    build({
      ...withLaunchUnit(),
      donowDispatch: vi.fn(async () => ({ decision: 'failed', message: 'Could not start the garage fitness kiosk.' })),
    });
    const { sid, record } = await launchSession();
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'failed', tokenClass: 'select_unit', printed: true });
    expect(thermal.lastTranscript()).toContain('Could not start the garage fitness kiosk');
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });

  // OPTIONAL-DEGRADING: a composition/fake that never wires `donow` must
  // never crash, and must never phantom-dispatch.
  it('with no donow wired, slips "ask a grown-up" rather than crashing', async () => {
    build({ ...withLaunchUnit(), wireDonow: false });
    const { sid, record } = await launchSession();
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'unavailable', tokenClass: 'select_unit', printed: true });
    expect(thermal.lastTranscript()).toContain('Ask a grown-up to set this up');
    expect(sessions.types(sid)).not.toContain('launch_dispatched');
  });
});

describe('a unit that finishes on the screen', () => {
  /** Unit 01 is media + bank with NO document, watched through to the end. */
  const watchedMediaUnit = async () => {
    const sid = 'ses_m';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent(sid, {
      type: 'media_dispatched', at: clock.iso(), sessionId: sid,
      dispatchId: 'dsp_1', target: 'living-room-tv', contentId: 'plex:481203',
    });
    await sessions.appendEvent(sid, { type: 'media_completed', at: clock.iso(), sessionId: sid, verified: 'playhead' });
    return sid;
  };

  // The reducer's `media_completed` next action is `issue_document`, so this is
  // the ticket a real agenda hands over. It used to reach IssueDocument, find no
  // document, and print "There is no sheet to print for this one" — a dead end
  // with the whole rest of the course behind it.
  it('an issue_document ticket on a bank-only unit opens the quiz instead of failing', async () => {
    const sessionId = await watchedMediaUnit();
    const record = mintToken({ tokenClass: 'issue_document', subject: { sessionId }, at: clock.iso(), rng });
    await tokens.put(record);

    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'open_on_screen', physical: 'receipt', printed: true });
    expect(result.effect).toMatchObject({ unitId: MEDIA_UNIT, bank: MEDIA_BANK_ID });
    expect(thermal.lastTranscript()).toMatch(/school screen/i);
    expect(thermal.lastTranscript()).not.toMatch(/no sheet to print/i);
    expect(laser.jobs).toEqual([]);
  });

  it('a unit that HAS a document still prints it after its media', async () => {
    const sid = 'ses_x';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MIXED_UNIT });
    await sessions.appendEvent(sid, {
      type: 'media_dispatched', at: clock.iso(), sessionId: sid,
      dispatchId: 'dsp_2', target: 'living-room-tv', contentId: 'plex:481204',
    });
    await sessions.appendEvent(sid, { type: 'media_completed', at: clock.iso(), sessionId: sid, verified: 'playhead' });
    const record = mintToken({ tokenClass: 'issue_document', subject: { sessionId: sid }, at: clock.iso(), rng });
    await tokens.put(record);
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'issued', physical: 'worksheet' });
    expect(laser.jobs).toHaveLength(1);
  });

  it('a recovery ticket on a bank-only unit does the same rather than failing to reprint', async () => {
    const sessionId = await watchedMediaUnit();
    const record = mintToken({ tokenClass: 'recovery', subject: { sessionId }, at: clock.iso(), rng });
    await tokens.put(record);
    const result = await resolve.execute({ code: record.token });
    expect(result.status).toBe('open_on_screen');
    expect(result.printed).toBe(true);
  });
});

describe('recovery', () => {
  it('a recovery ticket reprints the same artifact', async () => {
    await sessions.appendEvent('ses_w', { type: 'created', at: clock.iso(), sessionId: 'ses_w', learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    await sessions.appendEvent('ses_w', { type: 'issued', at: clock.iso(), sessionId: 'ses_w', artifactId: 'art_9' });
    const record = mintToken({ tokenClass: 'recovery', subject: { sessionId: 'ses_w' }, at: clock.iso(), rng });
    await tokens.put(record);
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'reprinted', physical: 'worksheet' });
    expect(result.effect.artifactId).toBe('art_9');
  });

  it('a print failure comes back as a slip with a fresh recovery ticket', async () => {
    await sessions.appendEvent('ses_w', { type: 'created', at: clock.iso(), sessionId: 'ses_w', learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    const record = mintToken({ tokenClass: 'select_unit', subject: { sessionId: 'ses_w' }, at: clock.iso(), rng });
    await tokens.put(record);
    laser.setFault('offline');
    const result = await resolve.execute({ code: record.token });
    expect(result).toMatchObject({ status: 'print_failed', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('printer is not answering');
  });
});

describe('the retry ticket', () => {
  const failWorksheet = async () => {
    const sid = 'ses_w';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    await sessions.appendEvent(sid, { type: 'issued', at: clock.iso(), sessionId: sid, artifactId: 'art_9' });
    await sessions.appendEvent(sid, { type: 'submitted', at: clock.iso(), sessionId: sid, transport: 'paper' });
    await sessions.appendEvent(sid, { type: 'graded', at: clock.iso(), sessionId: sid, attemptIds: ['att_1'], percent: 20 });
    return close.execute({ sessionId: sid });
  };

  it('opens the linked session AND prints the fresh variant in one scan', async () => {
    const outcome = await failWorksheet();
    const result = await resolve.execute({ code: outcome.retryToken });
    expect(result).toMatchObject({ status: 'issued', tokenClass: 'remediation', physical: 'worksheet' });
    expect(result.effect).toMatchObject({ remediationOf: 'ses_w', variant: 1 });
    expect(sessions.derive('ses_w')).toMatchObject({ state: 'remediation_opened', terminal: true });
    expect(laser.jobs).toHaveLength(1);
  });

  it('re-scanning the retry ticket says already_done rather than printing a third sheet', async () => {
    const outcome = await failWorksheet();
    await resolve.execute({ code: outcome.retryToken });
    const again = await resolve.execute({ code: outcome.retryToken });
    expect(again.status).toBe('already_done');
    expect(laser.jobs).toHaveLength(1);
  });
});

describe('the subject ticket', () => {
  const subjectToken = async (subject, learnerId = 'kid1') => {
    const record = mintToken({ tokenClass: 'subject_next', subject: { learnerId, subject }, at: clock.iso(), rng });
    await tokens.put(record);
    return record.token;
  };

  it('needs no existing session at all — one is created on the fly', async () => {
    expect(sessions.ids()).toEqual([]);
    const result = await resolve.execute({ code: await subjectToken('math') });
    // math's first move is MEDIA_UNIT at `created`, which is a video: the scan
    // both creates the session AND dispatches it in the same round trip.
    // `#play` always reports its own `media_action` tokenClass, subject ticket
    // or not — the physical outcome routes through the SAME helper a per-unit
    // ticket would reach, unchanged.
    expect(result).toMatchObject({ status: 'dispatched', tokenClass: 'media_action', physical: 'receipt', printed: true });
    expect(sessions.ids()).toHaveLength(1);
    expect(playback.dispatches).toHaveLength(1);
  });

  it('a subject served today prints a done-for-today slip, not a move', async () => {
    const sid = 'ses_v';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MEDIA_UNIT });
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sid}`, result: 'passed' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sid, { ...event, sessionId: sid, at: clock.iso() });
    }
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'served_today', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('done for today');
  });

  it('a locked subject prints the remedy, not a dead end', async () => {
    build({ assignment: { learnerId: 'kid1', units: [WORKSHEET_UNIT] } });
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'locked', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('Finish');
  });

  it('a subject with nothing assigned prints "nothing to hand out"', async () => {
    build({ assignment: null });
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'empty', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('Nothing to hand out');
  });

  it('a program subject whose launcher will not answer prints unavailable', async () => {
    build(withLanguageProgram()); // no launcher registered for PROGRAM_ID
    const result = await resolve.execute({ code: await subjectToken('language') });
    expect(result).toMatchObject({ status: 'unavailable', tokenClass: 'subject_next', physical: 'receipt', printed: true });
  });

  it('a program subject launches and reports it, printing a Portal slip', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        launch: vi.fn(async () => ({ decision: 'dispatched', message: 'Starting the Portal now.' })),
        // Explicit, like `LanguageProgramLauncher`'s own getter — a launcher
        // that declares no `locationHint` gets generic, location-agnostic
        // wording instead (spec review finding: the slip used to hardcode
        // "on the Portal" for every program, which was wrong for a surface
        // program like `pe-daily`; see surfaceProgramLauncher wiring).
        locationHint: 'on the Portal',
      }]]),
    });
    const result = await resolve.execute({ code: await subjectToken('language') });
    expect(result).toMatchObject({ status: 'launched', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('Starting on the Portal');
  });

  it('a program launcher with no locationHint gets generic, location-agnostic wording — never a guessed room', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        launch: vi.fn(async () => ({ decision: 'dispatched', message: 'Starting now.' })),
        // No locationHint at all — mirrors an unconfigured SurfaceProgramLauncher.
      }]]),
    });
    const result = await resolve.execute({ code: await subjectToken('language') });
    expect(result).toMatchObject({ status: 'launched', tokenClass: 'subject_next', printed: true });
    expect(thermal.lastTranscript()).toContain('Starting — off you go');
    expect(thermal.lastTranscript()).not.toMatch(/portal/i);
  });

  // Launchers now return DoNow's own `{decision, ...}` shape (Task 12, spec §6
  // last bullet: "occupancy applies uniformly") — a busy Portal pends here
  // exactly as a busy garage-fitness kiosk pends on the per-unit launch path.
  it('a program launch that is busy pends for a grown-up, never a phantom dispatch', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        launch: vi.fn(async () => ({
          decision: 'pending_approval', approvalId: 'dnr_1', message: 'The Portal is busy — we asked a grown-up.',
        })),
      }]]),
    });
    const result = await resolve.execute({ code: await subjectToken('language') });
    expect(result).toMatchObject({ status: 'pending_approval', tokenClass: 'subject_next', printed: true });
    expect(thermal.lastTranscript()).toContain('is busy — we asked a grown-up');
  });

  it('a program launch that is denied or fails still ends in a slip, never silence', async () => {
    build({
      ...withLanguageProgram(),
      launchers: new Map([[PROGRAM_ID, {
        status: async () => ({ doneToday: false, progressLabel: null, score: null }),
        launch: vi.fn(async () => ({ decision: 'failed', message: 'Could not start the Portal.' })),
      }]]),
    });
    const result = await resolve.execute({ code: await subjectToken('language') });
    expect(result).toMatchObject({ status: 'launch_unconfirmed', tokenClass: 'subject_next', printed: true });
    // The remedy line is now DoNow's own result message (mirrors
    // `#dispatchLaunch`'s identical branch) — never a hardcoded "Go to the
    // Portal", which used to lie for a program that was never on the Portal.
    expect(thermal.lastTranscript()).toContain('Could not start the Portal');
  });

  it('a move->print resolves the worksheet itself, not a receipt about it', async () => {
    // An open session on WORKSHEET_UNIT beats the course lock (planner rule),
    // so it is the section's `next` even with MEDIA_UNIT untouched.
    await sessions.appendEvent('ses_w', { type: 'created', at: clock.iso(), sessionId: 'ses_w', learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'issued', tokenClass: 'subject_next', physical: 'worksheet', printed: true });
    expect(laser.jobs).toHaveLength(1);
    expect(result.sessionId).toBe('ses_w');
  });

  // The bank hand-off routes through DoNow (Task 12 review — spec §6
  // "occupancy applies uniformly"): a screen mid-quiz for one child must not
  // be clobbered by another child's scan, which a direct PortalDispatch
  // broadcast could not protect against.
  const watchedMediaBankUnit = async () => {
    const sid = 'ses_m';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent(sid, {
      type: 'media_dispatched', at: clock.iso(), sessionId: sid,
      dispatchId: 'dsp_1', target: 'living-room-tv', contentId: 'plex:481203',
    });
    await sessions.appendEvent(sid, { type: 'media_completed', at: clock.iso(), sessionId: sid, verified: 'playhead' });
    return sid;
  };

  it('a move->screen dispatches through DoNow (portal surface) and resolves on-screen', async () => {
    const sid = await watchedMediaBankUnit();

    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'open_on_screen', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(result.effect).toMatchObject({ unitId: MEDIA_UNIT, bank: MEDIA_BANK_ID });
    expect(thermal.lastTranscript()).toMatch(/school screen/i);
    expect(donow.dispatch).toHaveBeenCalledWith({
      surface: 'portal',
      action: { target: { kind: 'bank', bankId: MEDIA_BANK_ID, unitId: MEDIA_UNIT, sessionId: sid } },
      learnerId: 'kid1', requestedBy: 'school-scan', ref: sid,
    });
  });

  it('a busy portal pends the screen hand-off, printing "we asked a grown-up"', async () => {
    build({
      donowDispatch: vi.fn(async () => ({
        decision: 'pending_approval', approvalId: 'dnr_1', message: 'The Portal is busy — we asked a grown-up.',
      })),
    });
    await watchedMediaBankUnit();

    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'pending_approval', tokenClass: 'subject_next', printed: true });
    expect(thermal.lastTranscript()).toContain('is busy — we asked a grown-up');
  });

  it('a denied/failed screen hand-off prints "go to the school screen and open it there"', async () => {
    build({ donowDispatch: vi.fn(async () => ({ decision: 'failed', message: 'Could not start the Portal.' })) });
    await watchedMediaBankUnit();

    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'failed', tokenClass: 'subject_next', printed: true });
    expect(thermal.lastTranscript()).toContain('Go to the school screen and open it there');
  });

  // OPTIONAL-DEGRADING: no donow wired falls back to the legacy direct
  // PortalDispatch broadcast — today's un-occupancy-checked behavior, kept
  // only for a deployment/fake that has not wired donow yet (flagged for
  // removal once Task 13 wires donow everywhere).
  it('with no donow wired, falls back to the legacy PortalDispatch broadcast', async () => {
    build({ portalLaunch: vi.fn(() => ({ dispatched: true })), wireDonow: false });
    const sid = await watchedMediaBankUnit();

    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'open_on_screen', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(portal.launch).toHaveBeenCalledWith({
      learnerId: 'kid1',
      target: { kind: 'bank', bankId: MEDIA_BANK_ID, unitId: MEDIA_UNIT, sessionId: sid },
    });
  });

  it('a move->launch routes through the SAME DoNow helper the per-unit path uses', async () => {
    build(withLaunchUnit());
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'dispatched', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('Starting — off you go');
    expect(donow.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      surface: LAUNCH_SURFACE, action: { episodeId: 'plex:999' }, learnerId: 'kid1', requestedBy: 'school-scan',
    }));
    expect(sessions.derive(result.sessionId).terminal).toBe(true);
  });

  it('a move->wait prints a slip carrying the move label', async () => {
    const sid = 'ses_v';
    await sessions.appendEvent(sid, { type: 'created', at: clock.iso(), sessionId: sid, learnerId: 'kid1', unitId: MEDIA_UNIT });
    await sessions.appendEvent(sid, {
      type: 'media_dispatched', at: clock.iso(), sessionId: sid,
      dispatchId: 'dsp_1', target: 'living-room-tv', contentId: 'plex:481203',
    });
    const result = await resolve.execute({ code: await subjectToken('math') });
    expect(result).toMatchObject({ status: 'wait', tokenClass: 'subject_next', physical: 'receipt', printed: true });
    expect(thermal.lastTranscript()).toContain('finish watching');
  });

  it('a move->retry opens a NEW session via OpenRemediation and prints the fresh sheet', async () => {
    const failedSessionId = 'ses_w';
    await sessions.appendEvent(failedSessionId, { type: 'created', at: clock.iso(), sessionId: failedSessionId, learnerId: 'kid1', unitId: WORKSHEET_UNIT });
    await sessions.appendEvent(failedSessionId, { type: 'issued', at: clock.iso(), sessionId: failedSessionId, artifactId: 'art_9' });
    await sessions.appendEvent(failedSessionId, { type: 'submitted', at: clock.iso(), sessionId: failedSessionId, transport: 'paper' });
    await sessions.appendEvent(failedSessionId, {
      type: 'graded', at: clock.iso(), sessionId: failedSessionId, attemptIds: ['att_1'], percent: 20,
    });
    await sessions.appendEvent(failedSessionId, {
      type: 'outcome_recorded', at: clock.iso(), sessionId: failedSessionId, outcomeId: `out:${failedSessionId}`, result: 'needs_remediation',
    });

    const result = await resolve.execute({ code: await subjectToken('math') });
    // `#retry` reports its own `remediation` tokenClass — the same physical
    // path a per-unit retry ticket reaches, unchanged by the subject wrapper.
    expect(result).toMatchObject({ status: 'issued', tokenClass: 'remediation', physical: 'worksheet', printed: true });
    // The fresh sheet came from a NEW session, linked back to the failed one —
    // never an `already_done` slip, and never a reprint of the failed session.
    expect(result.sessionId).not.toBe(failedSessionId);
    expect(result.effect).toMatchObject({ remediationOf: failedSessionId, variant: 1 });
    expect(sessions.derive(failedSessionId)).toMatchObject({ state: 'remediation_opened', terminal: true });
    expect(laser.jobs).toHaveLength(1);
  });
});

describe('the review mandate: an agenda-printed subject token actually resolves', () => {
  it('a token minted by a real BuildAgenda run goes through ResolveScanAction and issues a worksheet', async () => {
    // Pass MEDIA_UNIT so WORKSHEET_UNIT (a document unit) becomes the
    // subject's next offer — no test-only shortcut, this is the exact token
    // string a real agenda printout carries.
    const first = await agenda.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
      { type: 'rewarded', txnId: 'txn_1', amount: 5 },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    clock.advanceDays(1);

    const second = await agenda.execute({ learnerId: 'kid1' });
    const offer = second.offers.find((o) => o.subject === 'math');
    expect(offer).toBeTruthy();
    expect(offer.unitId).toBe(WORKSHEET_UNIT);
    expect(offer.tokenClass).toBe('subject_next');

    const result = await resolve.execute({ code: offer.token });
    expect(result).toMatchObject({ status: 'issued', tokenClass: 'subject_next', physical: 'worksheet', printed: true });
    expect(laser.jobs).toHaveLength(1);
  });
});

describe('the invariant', () => {
  it('every scan produces paper or says exactly why not', async () => {
    const codes = [
      await cardToken(),
      'sch:UNKNOWNTICKET',
      await cardToken('ghost'),
    ];
    for (const code of codes) {
      const result = await resolve.execute({ code });
      expect(result.physical).toBe('receipt');
      expect(result.printed).toBe(true);
      expect(result.message).toBeTruthy();
    }
  });
});
