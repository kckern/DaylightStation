import { describe, it, expect, beforeEach } from 'vitest';
import { BuildAgenda } from '#apps/school/usecases/BuildAgenda.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeAssignmentStore,
  fakeClock, seededRng, sequentialIds, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS,
  MEDIA_UNIT, WORKSHEET_UNIT, OMR_UNIT, MIXED_UNIT, fixtureUnit,
} from '#testlib/school/lifecycleFixtures.mjs';

let clock, catalog, curriculum, sessions, tokens, assignments, useCase;

const build = ({ assignment = { learnerId: 'kid1', courses: ['math-fractions'] }, units } = {}) => {
  clock = fakeClock();
  catalog = new FakeCatalog({ units: units ?? rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  tokens = new FakeTokenRegistry();
  assignments = new FakeAssignmentStore(assignment ? [assignment] : []);
  useCase = new BuildAgenda({
    curriculum, assignments, sessions, tokens,
    clock: clock.now, rng: seededRng(7), newSessionId: sequentialIds(),
    logger: silentLogger,
  });
};

beforeEach(() => build());

const offerFor = (result, unitId) => result.offers.find((o) => o.unitId === unitId);
const actions = (doc) => doc.blocks.filter((b) => b.type === 'scan_action');
const transcript = (doc) => doc.blocks.map((b) => b.md ?? b.label ?? '').join('\n');

describe('the agenda document', () => {
  it('is a valid receipt-target document', async () => {
    const { document } = await useCase.execute({ learnerId: 'kid1' });
    expect(validateDocument(document).errors).toEqual([]);
  });

  it('offers exactly the unlocked work — one scan action per choice', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.offers.map((o) => o.unitId)).toEqual([MEDIA_UNIT]);
    expect(actions(result.document)).toHaveLength(1);
  });

  it('prints locked units WITH their remedy rather than hiding them', async () => {
    const text = transcript((await useCase.execute({ learnerId: 'kid1' })).document);
    // Titles come from the fixture, never retyped: a remedy line that names a
    // unit by a title nothing carries is the drift this suite exists to catch.
    expect(text).toContain(fixtureUnit(WORKSHEET_UNIT).title);
    expect(text).toContain(`Finish “${fixtureUnit(MEDIA_UNIT).title}” first`);
  });

  it('labels the action from the unit composition, not the reducer default', async () => {
    // The first move on a video unit is to watch it, not to print a sheet.
    expect(offerFor(await useCase.execute({ learnerId: 'kid1' }), MEDIA_UNIT).label).toContain('watch or listen');
  });

  it('carries only opaque tokens — no learner, unit or policy on the paper', async () => {
    const { document } = await useCase.execute({ learnerId: 'kid1' });
    actions(document).forEach((action) => {
      expect(isSchoolToken(action.action)).toBe(true);
      expect(action.action).not.toContain('kid1');
      expect(action.action).not.toContain('fractions');
    });
  });
});

describe('sessions', () => {
  it('creates one work session per offered choice, before anything is issued', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.createdSessions).toEqual(['ses_1']);
    expect(sessions.types('ses_1')).toEqual(['created']);
    expect(sessions.derive('ses_1')).toMatchObject({ learnerId: 'kid1', unitId: MEDIA_UNIT, state: 'created' });
  });

  it('RE-SCANNING THE CARD REUSES THE SESSION — never a second one', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.createdSessions).toEqual([]);
    expect(offerFor(second, MEDIA_UNIT).sessionId).toBe(offerFor(first, MEDIA_UNIT).sessionId);
    expect(sessions.ids()).toEqual(['ses_1']);
  });

  it('mints a fresh ticket for the same session on a reprint', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers[0].token).not.toBe(first.offers[0].token);
    // Both still resolve to the same work: an older sheet is not dead paper.
    expect((await tokens.get(first.offers[0].token)).subject.sessionId)
      .toBe((await tokens.get(second.offers[0].token)).subject.sessionId);
  });

  it('does not open a session for a locked unit', async () => {
    await useCase.execute({ learnerId: 'kid1' });
    expect(sessions.ids()).toHaveLength(1);
  });
});

describe('tokens', () => {
  it('registers every minted token against its session', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    const record = await tokens.get(result.offers[0].token);
    expect(record).toMatchObject({ tokenClass: 'select_unit', subject: { sessionId: 'ses_1' } });
  });

  it('gives agenda tokens a conservative expiry', async () => {
    const result = await useCase.execute({ learnerId: 'kid1' });
    const record = await tokens.get(result.offers[0].token);
    expect(Date.parse(record.expiresAt) - Date.parse(record.issuedAt)).toBe(48 * 3_600_000);
  });

  it('honours a configured token lifetime', async () => {
    const short = new BuildAgenda({
      curriculum, assignments, sessions, tokens,
      clock: clock.now, rng: seededRng(3), newSessionId: sequentialIds('s_'),
      tokenTtlHours: 6, logger: silentLogger,
    });
    const result = await short.execute({ learnerId: 'kid1' });
    const record = await tokens.get(result.offers[0].token);
    expect(Date.parse(record.expiresAt) - Date.parse(record.issuedAt)).toBe(6 * 3_600_000);
  });
});

describe('progression', () => {
  it('offers the next unit once its predecessor has passed', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
      { type: 'rewarded', txnId: 'txn_1', amount: 5 },
    ]) {
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers.map((o) => o.unitId)).toEqual([WORKSHEET_UNIT]);
    expect(transcript(second.document)).toContain('print your sheet');
  });

  // Unit 01 is media + bank with NO document. The reducer cannot see units, so
  // its `media_completed` next action is hardcoded "print the questions" —
  // which offers a sheet that does not exist and dead-ends the whole course.
  it('offers the ON-SCREEN quiz after the media of a bank-only unit', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'media_dispatched', dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203' },
      { type: 'media_completed', verified: 'playhead' },
    ]) {
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(second, MEDIA_UNIT).label).toContain('answer on the screen');
    expect(transcript(second.document)).not.toContain('print the questions');
    // Still scannable: the line is what tells the child the quiz is open.
    expect(offerFor(second, MEDIA_UNIT).token).toBeTruthy();
  });

  it('still offers the SHEET after the media of a unit that has one', async () => {
    // Unit 04 is media + document: watching it releases a printed worksheet,
    // and that wording must not change with the bank-only fix.
    // An open session beats the sequence lock (planner rule), so watching unit
    // 04's audio is enough to make it the offered work.
    const sessionId = 'ses_mixed';
    for (const event of [
      { type: 'created', learnerId: 'kid1', unitId: MIXED_UNIT },
      { type: 'media_dispatched', dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203' },
      { type: 'media_completed', verified: 'playhead' },
    ]) {
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(offerFor(result, MIXED_UNIT).label).toContain('print the questions');
  });

  it('offers a mid-flight session the move its state actually allows', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    await sessions.appendEvent(sessionId, {
      type: 'media_dispatched', sessionId, at: clock.iso(),
      dispatchId: 'dsp_1', target: 'tv', contentId: 'plex:481203',
    });
    const second = await useCase.execute({ learnerId: 'kid1' });
    // Mid-play there is nothing to scan: the reducer's next action is to wait.
    expect(offerFor(second, MEDIA_UNIT).token).toBeNull();
    expect(transcript(second.document)).toContain('finish watching');
  });
});

describe('a unit with nothing to scan into (no media, document, or bank)', () => {
  it('still mints a select_unit token — the scan must never dead-end', async () => {
    // A unit graded entirely by a grown-up's own judgment (`review`, no
    // bank/document/media) is a legitimate composition — but `created` still
    // has to hand out a scannable ticket. Scanning it lands in
    // ResolveScanAction#start's empty branch ("Nothing to do there yet. Tell
    // a grown-up."), which exists precisely so this offer is never a dead end.
    build({
      units: rawUnits({
        [MEDIA_UNIT]: { media: undefined, bank: undefined, review: 'A grown-up reviews this by hand.' },
      }),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    const offer = offerFor(result, MEDIA_UNIT);
    expect(offer.token).toBeTruthy();
    expect(offer.tokenClass).toBe('select_unit');
    expect(offer.label).toContain('start this');
  });
});

describe('nothing to do', () => {
  it('says so when a learner has no assignment at all', async () => {
    build({ assignment: null });
    const result = await useCase.execute({ learnerId: 'kid1' });
    expect(result.offers).toEqual([]);
    expect(transcript(result.document)).toContain('Nothing is assigned');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('explains rather than failing when nobody can be identified', async () => {
    const result = await useCase.execute({ learnerId: null });
    expect(result.plan).toBeNull();
    expect(sessions.ids()).toEqual([]);
    expect(transcript(result.document)).toContain('Whose card is this?');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('ignores draft units — the promotion boundary reaches the printer', async () => {
    build({
      units: rawUnits({ [MEDIA_UNIT]: { provenance: { source: 'hand-authored', reviewState: 'draft' } } }),
    });
    const result = await useCase.execute({ learnerId: 'kid1' });
    // With unit one unpublished, unit two is the first published unit and is
    // gated by nothing that exists — so it is what gets offered.
    expect(result.offers.map((o) => o.unitId)).toEqual([WORKSHEET_UNIT]);
  });

  it('never offers a completed unit again', async () => {
    const first = await useCase.execute({ learnerId: 'kid1' });
    const sessionId = first.offers[0].sessionId;
    for (const event of [
      { type: 'issued', artifactId: 'art_1' },
      { type: 'submitted', transport: 'paper' },
      { type: 'graded', attemptIds: ['att_1'], percent: 90 },
      { type: 'outcome_recorded', outcomeId: `out:${sessionId}`, result: 'passed' },
      { type: 'rewarded', txnId: 'txn_1', amount: 5 },
    ]) {
      await sessions.appendEvent(sessionId, { ...event, sessionId, at: clock.iso() });
    }
    const second = await useCase.execute({ learnerId: 'kid1' });
    expect(second.offers.map((o) => o.unitId)).not.toContain(MEDIA_UNIT);
    expect(offerFor(second, OMR_UNIT)).toBeUndefined();
  });
});
