import { describe, it, expect, beforeEach } from 'vitest';
import { ResolveScanAction } from '#apps/school/usecases/ResolveScanAction.mjs';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';
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

let clock, rng, sessions, tokens, thermal, laser, playback, resolve, agenda, close;

const build = () => {
  clock = fakeClock();
  rng = seededRng(21);
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  tokens = new FakeTokenRegistry();
  thermal = new FakeReceiptPrinter();
  laser = new FakeLaserPrinter();
  playback = new FakePlayback();
  const formMaps = new FakeFormMapStore();
  const assignments = new FakeAssignmentStore([{ learnerId: 'kid1', courses: ['math-fractions'] }]);
  const receipts = new ReceiptPrinting({ renderer: new FakeReceiptRenderer(), printer: thermal, logger: silentLogger });

  agenda = new BuildAgenda({
    curriculum, assignments, sessions, tokens,
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
  resolve = new ResolveScanAction({
    tokens, sessions, curriculum, resolvePersonalCard: card, issueDocument,
    dispatchMedia, openRemediation, receipts, clock: clock.now, logger: silentLogger,
  });
};

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
    expect(thermal.lastTranscript()).toContain('Sam');
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
