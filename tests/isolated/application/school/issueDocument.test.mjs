import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IssueDocument } from '#apps/school/usecases/IssueDocument.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { validateDocument } from '#domains/school/documents/documentValidation.mjs';
import { isSchoolToken } from '#domains/school/sessions/tokens.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { pdfText, requirePdftotext } from '#testlib/school/pdfText.mjs';
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

// ── Tracked quizzes: print/<id>@<rev> document references (spec §9, Task 7) ──
//
// A whole different setup from `build()` above: the print-document pipeline
// (`RenderPrintDocument` + a real `YamlAllocationStore`, in-memory io — same
// "exercise the real pipeline" convention `ResolveCardScan.test.mjs` uses,
// not a hand-mocked renderer) is exercised end to end, against a lightweight
// hand-rolled `curriculum` double rather than the real `CurriculumAccess` +
// `FakeCatalog`: a unit whose `document` is `print/<id>@<rev>` cannot pass
// `validateUnit`'s reference-set check today (that set is built from the
// LEGACY document catalog only — widening it is out of this task's scope,
// spec §9's own "curriculum units... gain a print-document reference" is
// aspirational future wiring), so a real `CurriculumAccess` can never be
// coaxed into serving one. `IssueDocument` only ever calls `curriculum.getUnit`/
// `getDocument` — duck-typed, not `instanceof`-checked — so a minimal double
// is a legitimate, isolated way to exercise this branch without touching
// `CurriculumAccess`/`unitValidation.mjs`.
describe('tracked quizzes (print/<id>@<rev> document references, spec §9)', () => {
  const richText = (md) => ({ type: 'rich_text', md });
  const mcQuestion = (itemId, number, { choices, answer } = {}) => ({
    type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answer,
  });
  const sourceQuiz = (id, over = {}) => ({
    schema: DOCUMENT_SOURCE_SCHEMA,
    id,
    seed: 12345,
    variant: 0,
    target: ['letter'],
    archetype: 'quiz',
    title: id,
    blocks: [
      mcQuestion('q1', 1, { choices: ['Alpha', 'Beta', 'Gamma'], answer: 'Alpha' }),
      mcQuestion('q2', 2, { choices: ['Alpha', 'Beta', 'Gamma'], answer: 'Beta' }),
    ],
    ...over,
  });

  /** In-memory `YamlPrintDocumentRepository`-shaped fake (mirrors ResolveCardScan.test.mjs's own). */
  function fakeRepository() {
    const published = new Map();
    const banks = new Map();
    const latestRevById = new Map();
    return {
      async writePublished({ document, bank, rev }) {
        const key = `${document.id}@${rev}`;
        published.set(key, document);
        if (bank) banks.set(key, bank);
        latestRevById.set(document.id, rev);
        return {
          document: { written: true, alreadyPublished: false },
          bank: bank ? { written: true, alreadyPublished: false } : null,
        };
      },
      async getPublished(id, rev) {
        const resolvedRev = rev ?? latestRevById.get(id);
        if (!resolvedRev) return null;
        return published.get(`${id}@${resolvedRev}`) ?? null;
      },
      async getDerivedBank(id, rev) {
        return banks.get(`${id}@${rev}`) ?? null;
      },
    };
  }

  /**
   * Fresh in-memory `YamlAllocationStore` — no filesystem. `rng` defaults to
   * the platform RNG (not a fixed constant, unlike most fixtures in this
   * file): a "reprint" issues a SECOND `freshCard` allocation against the
   * SAME store within one test, and a constant draw would mint the identical
   * 7-digit card id both times, making the second allocation collide with
   * itself until `#generateFreshCardId`'s retry budget exhausts. No test here
   * asserts a specific card id value, so real randomness costs nothing.
   */
  function fakeAllocationStore(over = {}) {
    const map = new Map();
    const io = {
      load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
      save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    };
    return new YamlAllocationStore({
      directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z', rng: Math.random, ...over,
    });
  }

  const PRINT_UNIT = 'quiz-unit';
  const QUIZ_DOC_ID = 'tracked-quiz-1';

  let repository; let allocationStore; let renderPrintDocument;
  let printClock; let printSessions; let printTokens; let printFormMaps; let printRenderer; let printPrinter;
  let printRev; let printUseCase;
  let curriculum;

  /** Publishes the fixture quiz once and wires an IssueDocument whose curriculum resolves PRINT_UNIT to it. */
  const buildPrintCase = async ({ configured = true } = {}) => {
    repository = fakeRepository();
    allocationStore = fakeAllocationStore();
    renderPrintDocument = new RenderPrintDocument({ repository, allocationStore });

    const publisher = new PublishPrintDocument({ repository });
    const { rev } = await publisher.execute({ source: sourceQuiz(QUIZ_DOC_ID) });
    printRev = rev;

    curriculum = {
      async getUnit(unitId) {
        return unitId === PRINT_UNIT
          ? { unitId: PRINT_UNIT, document: `print/${QUIZ_DOC_ID}@${rev}` }
          : null;
      },
      // Never legitimately reached for a print-document unit — see the
      // describe block's own header comment.
      async getDocument() {
        throw new Error('legacy curriculum.getDocument must not be called for a print-document unit');
      },
    };

    printClock = fakeClock();
    printSessions = new FakeSessionRepository();
    printTokens = new FakeTokenRegistry();
    printFormMaps = new FakeFormMapStore();
    printRenderer = new FakeDocumentRenderer();
    printPrinter = new FakeLaserPrinter();
    let artifactSeq = 0;
    printUseCase = new IssueDocument({
      curriculum, sessions: printSessions, tokens: printTokens, renderer: printRenderer,
      printer: printPrinter, formMaps: printFormMaps,
      ...(configured ? { printDocuments: repository, renderPrintDocument, allocationStore } : {}),
      clock: printClock.now, rng: seededRng(11),
      newArtifactId: () => `art_${++artifactSeq}`,
      logger: silentLogger,
    });
  };

  const openPrintSession = async (sessionId = 'ses_print', unitId = PRINT_UNIT) => {
    await printSessions.appendEvent(sessionId, {
      type: 'created', at: printClock.iso(), sessionId, learnerId: 'kid1', unitId,
    });
    return sessionId;
  };

  beforeEach(() => buildPrintCase());

  it('renders through RenderPrintDocument, prints, and records the issue', async () => {
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result).toMatchObject({ status: 'issued', artifactId: 'art_1', document: null, formMap: null });
    expect(result.pageCount).toBeGreaterThan(0);
    expect(printPrinter.jobs).toHaveLength(1);
    expect(printPrinter.jobs[0].pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(printSessions.types(sid)).toEqual(['created', 'issued']);
    expect(printSessions.derive(sid).issuedArtifacts).toEqual(['art_1']);
  });

  it('prints a quiz SINGLE-SIDED, because its punch gutter does not alternate', async () => {
    // The renderer reserves the 3-hole-punch gutter on the LEFT of every page
    // for every archetype except `worksheet`. Printed double-sided, page 2's
    // reserved margin would sit on the opposite physical edge of the same
    // sheet, and punching the stack would destroy content on every verso — so
    // the job follows the geometry the render actually drew, never a global
    // adapter default that never looked at the document. (The `worksheet`
    // half of this pairing is asserted at the render layer, in
    // RenderPrintDocument.test.mjs: a worksheet archetype has no
    // row-consuming OMR questions, so it cannot take the card-attached path
    // this use case drives.)
    const sid = await openPrintSession();
    await printUseCase.execute({ sessionId: sid });
    expect(printPrinter.jobs[0].opts.duplex).toBe(false);
  });

  it('never touches the legacy curriculum.getDocument lookup', async () => {
    const sid = await openPrintSession();
    // curriculum.getDocument throws if called at all (see the fixture above) —
    // a throw here would surface as a render_failed/thrown test, not silence.
    await expect(printUseCase.execute({ sessionId: sid })).resolves.toMatchObject({ status: 'issued' });
  });

  it('writes a fresh card allocation record that scan-back can find', async () => {
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.allocation).toMatchObject({ status: 'live' });
    const records = await allocationStore.findByCard(result.allocation.cardId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      recordId: result.allocation.recordId,
      documentId: QUIZ_DOC_ID,
      rev: printRev,
      learnerId: 'kid1',
      status: 'live',
    });
  });

  it('writes the allocation record BEFORE the issue event (ordering, spied)', async () => {
    const sid = await openPrintSession();
    const order = [];
    const originalAllocate = allocationStore.allocate.bind(allocationStore);
    allocationStore.allocate = async (...args) => {
      order.push('allocate');
      return originalAllocate(...args);
    };
    const originalAppend = printSessions.appendEvent.bind(printSessions);
    printSessions.appendEvent = async (...args) => {
      order.push('appendEvent');
      return originalAppend(...args);
    };

    await printUseCase.execute({ sessionId: sid });
    expect(order).toEqual(['allocate', 'appendEvent']);
  });

  // Task 7 review, Finding 2 (Important): a failure AFTER the allocation
  // write used to leave a durable `live` record with no logged cardId and no
  // release — an undiscoverable orphan that burns a fresh card on every
  // retry. Both branches below force that ordering (allocation succeeds,
  // something AFTER it fails) and assert the record ends `released`, with
  // the orphan warning naming the stranded cardId.
  it('a PRINT failure after a successful allocation logs the orphan warning and releases the card', async () => {
    const sid = await openPrintSession();
    const warnSpy = vi.fn();
    let artifactSeq = 0;
    const useCase = new IssueDocument({
      curriculum, sessions: printSessions, tokens: printTokens, renderer: printRenderer,
      printer: printPrinter, formMaps: printFormMaps,
      printDocuments: repository, renderPrintDocument, allocationStore,
      clock: printClock.now, rng: seededRng(11), newArtifactId: () => `art_${++artifactSeq}`,
      logger: { ...silentLogger, warn: warnSpy },
    });
    printPrinter.setFault('offline');

    const result = await useCase.execute({ sessionId: sid });
    expect(result.status).toBe('print_failed');
    expect(printSessions.derive(sid).lastFailure).toMatchObject({ stage: 'print' });

    const orphanCall = warnSpy.mock.calls.find(([event]) => event === 'school.issue.allocation-orphaned');
    expect(orphanCall).toBeTruthy();
    const [, orphaned] = orphanCall;
    expect(orphaned).toMatchObject({ sessionId: sid, stage: 'print' });
    expect(orphaned.cardId).toMatch(/^\d{7}$/);

    const releasedCall = warnSpy.mock.calls.find(([event]) => event === 'school.issue.allocation-released');
    expect(releasedCall).toBeTruthy();
    expect(releasedCall[1]).toMatchObject({ cardId: orphaned.cardId, releasedCount: 1 });

    const records = await allocationStore.findByCard(orphaned.cardId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ recordId: orphaned.recordId, status: 'released' });
  });

  it('a RENDER failure after a successful allocation logs the orphan warning and releases the card', async () => {
    const sid = await openPrintSession();
    // A real RenderPrintDocument, sharing the SAME repository/allocationStore
    // (so the allocation it writes is inspectable afterward) but with a
    // renderer factory that always throws — the allocation write happens
    // BEFORE this call inside RenderPrintDocument's own `#renderV2` (see its
    // doc comments), so this reproduces "allocation succeeded, then the
    // render itself failed" deterministically.
    const explodingRenderer = () => ({ render: async () => { throw new Error('renderer exploded'); } });
    const explodingRenderPrintDocument = new RenderPrintDocument({
      repository, allocationStore, renderer: explodingRenderer,
    });
    const warnSpy = vi.fn();
    const useCase = new IssueDocument({
      curriculum, sessions: printSessions, tokens: printTokens, renderer: printRenderer,
      printer: printPrinter, formMaps: printFormMaps,
      printDocuments: repository, renderPrintDocument: explodingRenderPrintDocument, allocationStore,
      clock: printClock.now, rng: seededRng(11), newArtifactId: () => 'art_render_fail',
      logger: { ...silentLogger, warn: warnSpy },
    });

    const result = await useCase.execute({ sessionId: sid });
    expect(result.status).toBe('render_failed');
    expect(printPrinter.jobs).toEqual([]); // never reached the printer
    expect(printSessions.derive(sid).lastFailure).toMatchObject({ stage: 'render' });

    const orphanCall = warnSpy.mock.calls.find(([event]) => event === 'school.issue.allocation-orphaned');
    expect(orphanCall).toBeTruthy();
    const [, orphaned] = orphanCall;
    expect(orphaned).toMatchObject({ sessionId: sid, stage: 'render' });
    expect(orphaned.cardId).toMatch(/^\d{7}$/);

    const releasedCall = warnSpy.mock.calls.find(([event]) => event === 'school.issue.allocation-released');
    expect(releasedCall).toBeTruthy();
    expect(releasedCall[1]).toMatchObject({ cardId: orphaned.cardId, releasedCount: 1 });

    const records = await allocationStore.findByCard(orphaned.cardId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: 'released' });
  });

  it('a failure BEFORE any allocation write never logs an orphan warning (nothing to release)', async () => {
    // Reuses the "dangling print-document reference" scenario: no-document
    // never reaches render at all, so #orphanAllocation must never fire.
    curriculum.getUnit = async (unitId) => (unitId === PRINT_UNIT
      ? { unitId: PRINT_UNIT, document: `print/${QUIZ_DOC_ID}@not-a-real-rev` }
      : null);
    const warnSpy = vi.fn();
    const useCase = new IssueDocument({
      curriculum, sessions: printSessions, tokens: printTokens, renderer: printRenderer,
      printer: printPrinter, formMaps: printFormMaps,
      printDocuments: repository, renderPrintDocument, allocationStore,
      clock: printClock.now, rng: seededRng(11), newArtifactId: () => 'art_no_doc',
      logger: { ...silentLogger, warn: warnSpy },
    });
    const sid = await openPrintSession();
    await useCase.execute({ sessionId: sid });
    expect(warnSpy.mock.calls.some(([event]) => event === 'school.issue.allocation-orphaned')).toBe(false);
  });

  it('mints no scan_action/media_action tokens for a print-document quiz (none in the v2 envelope)', async () => {
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.tokens).toEqual({});
  });

  it('threads the minted token through to the rendered PDF\'s barcode text for a scan_action block (F3 review fix, Medium/blocker)', async () => {
    requirePdftotext();
    // A SEPARATE document from the shared `QUIZ_DOC_ID` fixture (which has no
    // action blocks — see the test just above): one scored question plus a
    // scan_action block, published fresh and pointed to by the SAME
    // PRINT_UNIT the shared curriculum double already resolves.
    const tokenQuizId = 'tracked-quiz-with-scan-action';
    const publisher = new PublishPrintDocument({ repository });
    const { rev: tokenRev } = await publisher.execute({
      source: sourceQuiz(tokenQuizId, {
        blocks: [
          mcQuestion('tq1', 1, { choices: ['Alpha', 'Beta'], answer: 'Alpha' }),
          { type: 'scan_action', action: 'media_action', label: 'Play a video' },
        ],
      }),
    });
    curriculum.getUnit = async (unitId) => (unitId === PRINT_UNIT
      ? { unitId: PRINT_UNIT, document: `print/${tokenQuizId}@${tokenRev}` }
      : null);

    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.status).toBe('issued');
    expect(Object.keys(result.tokens)).toEqual(['media_action']);
    const mintedToken = result.tokens.media_action;

    expect(printPrinter.jobs).toHaveLength(1);
    const text = pdfText(printPrinter.jobs[0].pdf);
    // The barcode prints the REAL minted token — before F3's fix, RenderPrintDocument
    // never received `context.tokens` at all, so `measure.mjs`'s `actionCodeText`
    // fell all the way back to the block's own `.action` literal instead.
    expect(text).toContain(mintedToken);
    expect(text).not.toContain('media_action');
  });

  it('a reprint reuses the ORIGINAL artifact id but still allocates a fresh physical card', async () => {
    const sid = await openPrintSession();
    const first = await printUseCase.execute({ sessionId: sid });
    const second = await printUseCase.execute({ sessionId: sid });
    expect(second).toMatchObject({ status: 'reprinted', artifactId: first.artifactId });
    expect(printSessions.types(sid)).toEqual(['created', 'issued', 'reprinted']);
    expect(printPrinter.jobs).toHaveLength(2);
  });

  it('degrades to unavailable (never throws) when the print-document deps are not configured', async () => {
    await buildPrintCase({ configured: false });
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.status).toBe('unavailable');
    expect(printPrinter.jobs).toEqual([]);
    expect(printSessions.types(sid)).toEqual(['created']);
  });

  it('explains a dangling print-document reference (published doc not found) instead of throwing', async () => {
    curriculum.getUnit = async (unitId) => (unitId === PRINT_UNIT
      ? { unitId: PRINT_UNIT, document: `print/${QUIZ_DOC_ID}@not-a-real-rev` }
      : null);
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.status).toBe('unavailable');
    expect(printPrinter.jobs).toEqual([]);
  });

  it('a unit document that does not match print/<id>@<rev> falls through to legacy resolution (and fails cleanly with no legacy document)', async () => {
    curriculum.getUnit = async (unitId) => (unitId === PRINT_UNIT
      ? { unitId: PRINT_UNIT, document: 'not-a-print-ref' }
      : null);
    curriculum.getDocument = async () => null; // legacy lookup IS legitimately reached this time
    const sid = await openPrintSession();
    const result = await printUseCase.execute({ sessionId: sid });
    expect(result.status).toBe('unavailable');
  });

  // Task 7 review, Finding 1 (Important): the duck-typed `curriculum` double
  // used everywhere above proves IssueDocument's OWN branch is correct, but
  // NOT that a real, authored unit YAML can ever reach it — `validateUnit`
  // (unitValidation.mjs) used to reject `document: print/<id>@<rev>` outright
  // (dangling-reference error, since `documentIds` never contains a print
  // ref), which would have kept a real unit out of the publishable catalog
  // forever. `unitValidation.mjs` now shape-validates (not existence-checks)
  // a `print/` ref; this test proves the WHOLE real chain — real
  // `validateUnit` -> real `CurriculumAccess.getUnit` -> `IssueDocument` ->
  // real `RenderPrintDocument` — actually works end to end, not just the
  // duck-typed shortcut.
  it('a REAL CurriculumAccess (real validateUnit) resolves and issues a print-document unit end to end (spec §9, Task 7 review Finding 1)', async () => {
    const catalog = new FakeCatalog({
      units: [{
        unitId: PRINT_UNIT,
        title: 'Tracked quiz',
        subject: 'math',
        document: `print/${QUIZ_DOC_ID}@${printRev}`,
        provenance: { source: 'hand-authored', reviewState: 'approved' },
      }],
    });
    const realCurriculum = new CurriculumAccess({ catalog, clock: printClock.epoch, logger: silentLogger });

    // Proves reachability at the CurriculumAccess layer specifically —
    // `validateUnit` no longer drops the unit as an unresolvable reference.
    const resolvedUnit = await realCurriculum.getUnit(PRINT_UNIT);
    expect(resolvedUnit).toMatchObject({ document: `print/${QUIZ_DOC_ID}@${printRev}` });

    // And proves the full IssueDocument path still works when wired against
    // that real curriculum instead of the test double.
    const realUseCase = new IssueDocument({
      curriculum: realCurriculum, sessions: printSessions, tokens: printTokens, renderer: printRenderer,
      printer: printPrinter, formMaps: printFormMaps,
      printDocuments: repository, renderPrintDocument, allocationStore,
      clock: printClock.now, rng: seededRng(11), newArtifactId: () => 'art_real_1',
      logger: silentLogger,
    });
    const sid = await openPrintSession('ses_real');
    const result = await realUseCase.execute({ sessionId: sid });
    expect(result).toMatchObject({ status: 'issued', artifactId: 'art_real_1' });
    expect(result.allocation).toMatchObject({ status: 'live' });
    expect(printPrinter.jobs).toHaveLength(1);
  });
});
