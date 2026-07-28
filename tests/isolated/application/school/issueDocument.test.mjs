import { describe, it, expect, beforeEach } from 'vitest';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import {
  FakeCatalog, FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore,
  FakeDocumentRenderer, FakeLaserPrinter,
  fakeClock, seededRng, silentLogger,
} from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, printedFormMap,
  WORKSHEET_UNIT, OMR_UNIT, MEDIA_UNIT, MIXED_UNIT,
  WORKSHEET_DOCUMENT_ID, OMR_DOCUMENT_ID,
} from '#testlib/school/lifecycleFixtures.mjs';

let clock, sessions, tokens, formMaps, renderer, printer, useCase;

const SID = 'ses_1';

const build = ({ formMapFor = null } = {}) => {
  clock = fakeClock();
  const catalog = new FakeCatalog({ units: rawUnits(), documents: rawDocuments(), manifests: rawManifests() });
  const curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  tokens = new FakeTokenRegistry();
  formMaps = new FakeFormMapStore();
  renderer = new FakeDocumentRenderer({ formMapFor });
  printer = new FakeLaserPrinter();
  let artifactSeq = 0;
  useCase = new IssueDocument({
    curriculum, sessions, tokens, renderer, printer, formMaps,
    bankReader: { getBank: (id) => ({ id, items: [] }) },
    clock: clock.now, rng: seededRng(11),
    newArtifactId: () => `art_${++artifactSeq}`,
    logger: silentLogger,
  });
};

const openSession = async (unitId = WORKSHEET_UNIT, sessionId = SID) => {
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId: 'kid1', unitId });
  return sessionId;
};

beforeEach(() => build());

describe('the happy path', () => {
  it('renders, prints, and records the issue', async () => {
    await openSession();
    const result = await useCase.execute({ sessionId: SID });
    expect(result).toMatchObject({ status: 'issued', artifactId: 'art_1', pageCount: 2, document: null });
    expect(printer.jobs).toHaveLength(1);
    expect(sessions.types(SID)).toEqual(['created', 'issued']);
    expect(sessions.derive(SID).issuedArtifacts).toEqual(['art_1']);
  });

  it('sends a real PDF, named for the unit and the artifact', async () => {
    await openSession();
    await useCase.execute({ sessionId: SID });
    const [job] = printer.jobs;
    expect(job.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(job.opts).toMatchObject({ jobName: `school-${WORKSHEET_UNIT}-art_1`, user: 'kid1' });
  });

  it('mints one opaque token per scan_action the sheet declares', async () => {
    await openSession();
    const result = await useCase.execute({ sessionId: SID });
    expect(Object.keys(result.tokens)).toEqual(['recovery']);
    expect(isSchoolToken(result.tokens.recovery)).toBe(true);
    expect(await tokens.get(result.tokens.recovery)).toMatchObject({ tokenClass: 'recovery', subject: { sessionId: SID } });
  });

  // A printed barcode that resolves to nothing is a dead end on an artifact a
  // child is physically holding. `media_action` is a token class too, so the
  // "play this again" box on a sheet gets a real ticket like any other.
  it('mints for a media_action box as well, so no printed code is inert', async () => {
    await openSession(MIXED_UNIT);
    const result = await useCase.execute({ sessionId: SID });
    expect(Object.keys(result.tokens).sort()).toEqual(['media_action', 'recovery']);
    expect(await tokens.get(result.tokens.media_action)).toMatchObject({
      tokenClass: 'media_action', subject: { sessionId: SID },
    });
  });

  it('leaves an action naming no token class alone — not every box is a ticket', async () => {
    await openSession();
    const doc = rawDocuments().find((d) => d.id === WORKSHEET_DOCUMENT_ID);
    expect(doc.blocks.some((b) => b.type === 'scan_action' && b.action === 'recovery')).toBe(true);
    const result = await useCase.execute({ sessionId: SID });
    expect(Object.keys(result.tokens)).toEqual(['recovery']);
  });

  it('hands the token VALUES to the renderer — minting is not a renderer concern', async () => {
    await openSession();
    const result = await useCase.execute({ sessionId: SID });
    expect(renderer.calls[0].opts.tokens).toEqual(result.tokens);
  });

  it('passes the session variant so a retry sheet is the right one', async () => {
    await sessions.appendEvent('ses_r', {
      type: 'created', at: clock.iso(), sessionId: 'ses_r', learnerId: 'kid1',
      unitId: WORKSHEET_UNIT, remediationOf: SID, variant: 2,
    });
    await useCase.execute({ sessionId: 'ses_r' });
    expect(renderer.calls[0].opts.variant).toBe(2);
    // And on the document itself — the renderer derives the form map's identity
    // from what it was handed, so a variant only in the options is a variant the
    // paper does not carry.
    expect(renderer.calls[0].document.variant).toBe(2);
  });

  it('hands the document through untouched when the variant already matches', async () => {
    await openSession();
    await useCase.execute({ sessionId: SID });
    expect(renderer.calls[0].document.variant).toBe(0);
  });

  it('does not write a form map for a sheet that has no bubbles', async () => {
    await openSession();
    await useCase.execute({ sessionId: SID });
    expect(formMaps.ids()).toEqual([]);
  });
});

describe('form maps', () => {
  beforeEach(() => build({ formMapFor: (doc, opts) => printedFormMap({ documentId: doc.id, variant: opts.variant ?? 0 }) }));

  it('keeps the form map under the artifact id', async () => {
    await openSession(OMR_UNIT);
    const result = await useCase.execute({ sessionId: SID });
    expect(formMaps.ids()).toEqual([result.artifactId]);
    expect(await formMaps.get(result.artifactId)).toMatchObject({ documentId: OMR_DOCUMENT_ID });
  });

  it('a reprint resolves to the IDENTICAL form map', async () => {
    await openSession(OMR_UNIT);
    const first = await useCase.execute({ sessionId: SID });
    const before = await formMaps.get(first.artifactId);
    const second = await useCase.execute({ sessionId: SID });
    expect(second.artifactId).toBe(first.artifactId);
    expect(await formMaps.get(first.artifactId)).toEqual(before);
    expect(formMaps.ids()).toHaveLength(1);
  });
});

describe('reprinting', () => {
  it('reuses the ORIGINAL artifact id and appends a lineage event', async () => {
    await openSession();
    const first = await useCase.execute({ sessionId: SID });
    const second = await useCase.execute({ sessionId: SID });
    expect(second).toMatchObject({ status: 'reprinted', artifactId: first.artifactId });
    expect(sessions.types(SID)).toEqual(['created', 'issued', 'reprinted']);
    expect(sessions.derive(SID).issuedArtifacts).toEqual([first.artifactId]);
    expect(sessions.derive(SID).errors).toEqual([]);
  });

  it('prints a second time — a reprint is a real piece of paper', async () => {
    await openSession();
    await useCase.execute({ sessionId: SID });
    await useCase.execute({ sessionId: SID });
    expect(printer.jobs).toHaveLength(2);
  });
});

describe('printer offline', () => {
  it('never throws at the caller', async () => {
    await openSession();
    printer.setFault('offline');
    await expect(useCase.execute({ sessionId: SID })).resolves.toMatchObject({ status: 'print_failed' });
  });

  it('records the failure WITHOUT advancing the state, so the ticket stays valid', async () => {
    await openSession();
    printer.setFault('offline');
    await useCase.execute({ sessionId: SID });
    const state = sessions.derive(SID);
    expect(state.state).toBe('created');
    expect(state.lastFailure).toMatchObject({ stage: 'print' });
    expect(state.errors).toEqual([]);
  });

  it('hands back a slip carrying a recovery ticket', async () => {
    await openSession();
    printer.setFault('offline');
    const result = await useCase.execute({ sessionId: SID });
    expect(validateDocument(result.document).errors).toEqual([]);
    const action = result.document.blocks.find((b) => b.type === 'scan_action');
    expect(isSchoolToken(action.action)).toBe(true);
    expect(await tokens.get(action.action)).toMatchObject({ tokenClass: 'recovery' });
  });

  it('the next scan succeeds once the printer is back, with no artifact left behind', async () => {
    await openSession();
    printer.setFault('offline');
    await useCase.execute({ sessionId: SID });
    printer.setFault(null);
    const result = await useCase.execute({ sessionId: SID });
    expect(result.status).toBe('issued');
    expect(sessions.derive(SID)).toMatchObject({ state: 'issued', lastFailure: null, issuedArtifacts: ['art_2'] });
  });

  it('says the printer is not answering ONLY when that is what happened', async () => {
    await openSession();
    printer.setFault('offline');
    const result = await useCase.execute({ sessionId: SID });
    expect(result.message).toMatch(/printer/i);
    expect(result.document.blocks[0].md).toMatch(/printer is not answering/i);
  });

  it('treats a renderer explosion as a retryable failure, without blaming the printer', async () => {
    await openSession();
    renderer.render = async () => { throw new Error('math too tall for the page'); };
    const result = await useCase.execute({ sessionId: SID });
    expect(result.status).toBe('render_failed');
    expect(sessions.derive(SID).lastFailure).toMatchObject({ stage: 'render', reason: 'math too tall for the page' });
    expect(printer.jobs).toEqual([]);
    // The printer is fine. Saying otherwise sends a grown-up to the wrong box.
    expect(result.message).not.toMatch(/printer/i);
    expect(result.document.blocks[0].md).not.toMatch(/printer/i);
  });

  // A worksheet with an `asset` block and no resolvable artwork is the one
  // render failure a retry can never clear on its own — the recovery ticket
  // would fail identically forever. It gets its own words.
  it('names a missing picture as a missing picture', async () => {
    await openSession();
    renderer.render = async () => {
      const err = new Error("blocks[1]: asset 'school/math/fraction-strips' could not be resolved to artwork");
      err.name = 'UnresolvedAssetError';
      throw err;
    };
    const result = await useCase.execute({ sessionId: SID });
    expect(result.status).toBe('render_failed');
    expect(result.message).toMatch(/picture/i);
    expect(result.message).not.toMatch(/printer/i);
    expect(result.document.blocks[0].md).toMatch(/picture/i);
    // Still a ticket: a grown-up fixes the artwork, the child scans and retries.
    const action = result.document.blocks.find((b) => b.type === 'scan_action');
    expect(await tokens.get(action.action)).toMatchObject({ tokenClass: 'recovery' });
  });
});

describe('nothing to issue', () => {
  it('explains an unknown session instead of throwing', async () => {
    const result = await useCase.execute({ sessionId: 'ses_nope' });
    expect(result.status).toBe('unavailable');
    expect(validateDocument(result.document).errors).toEqual([]);
  });

  it('explains a unit that has no document at all', async () => {
    await openSession(MEDIA_UNIT);
    const result = await useCase.execute({ sessionId: SID });
    expect(result.status).toBe('unavailable');
    expect(printer.jobs).toEqual([]);
  });

  it('says already_done once the work has moved past printing', async () => {
    await openSession();
    await useCase.execute({ sessionId: SID });
    await sessions.appendEvent(SID, { type: 'submitted', at: clock.iso(), sessionId: SID, transport: 'paper' });
    const result = await useCase.execute({ sessionId: SID });
    expect(result.status).toBe('already_done');
    expect(printer.jobs).toHaveLength(1);
    expect(sessions.derive(SID).errors).toEqual([]);
  });
});
