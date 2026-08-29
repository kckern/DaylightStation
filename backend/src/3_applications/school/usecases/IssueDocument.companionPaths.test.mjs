// backend/src/3_applications/school/usecases/IssueDocument.companionPaths.test.mjs
// @vitest-environment node
//
// ONLY THE SOLO BANK-WORKSHEET PATH CAN CARRY A GATE ROW.
//
// `#prepareCompanion` — which mints the finish code and is the only thing that
// makes a gate row print — has exactly one call site, inside
// `#issueWorksheetInstance`. Two other pipelines in this same file issue paper:
// `#issuePrintDocument` (a `print/<id>@<rev>` tracked quiz) and
// `#issueLegacyDocument` (the legacy curriculum document map). Neither prepares
// a companion, so a lesson authored `participation: required` on either of them
// printed a sheet with NO gate row — and a sheet with no gate row passes on
// score alone, which is the one outcome the whole feature exists to prevent.
//
// A per-path gate row is a feature, not a fix (`COMPANION_GATE_ITEM_ID` is a
// single fixed constant, one gate per card). So these paths REFUSE instead,
// through the same `#unavailable` slip every other "we could not print that"
// branch already uses.
//
// The third and fourth cases in each block are the regression that would
// otherwise reach every worksheet in the house: an OPTIONAL companion, and no
// companion at all, must both still print exactly as they did.
import { describe, it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import {
  FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, seededRng,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

const NOW = '2026-08-28T17:00:00.000Z';
const PRINT_REF = 'print/quiz-one@abc123def';

function renderedPdf(content, { pageCount = 1, formMap = null } = {}) {
  const bytes = Buffer.from(content);
  const artifact = (payload) => ({
    printWith: (printer, options) => printer.printPdf(payload, options),
    retainWith: async (store, metadata) => {
      if (!store) return artifact(payload);
      const retained = await store.put({ ...metadata, bytes: payload });
      return artifact(retained.bytes);
    },
  });
  return { artifact: artifact(bytes), pageCount, formMap };
}

/** Every `warn` the use case emitted, so a refusal can be shown to leave a trace. */
function recordingLogger() {
  const warns = [];
  return {
    warns,
    info() {}, debug() {}, error() {},
    warn(event, data) { warns.push({ event, data }); },
  };
}

const companionOf = (participation) => (participation
  ? { companion: { enabled: true, participation, label: 'Read along' } }
  : {});

/**
 * A legacy-document unit: `document` names a plain catalog id, so `#issueNew`
 * falls all the way through to `#issueLegacyDocument`.
 */
const legacyUnit = (participation) => ({
  unitId: 'legacy-lesson',
  title: 'A legacy lesson',
  subject: 'scripture',
  courseId: 'cfm',
  document: 'doc-legacy',
  passing: { percent: 80 },
  provenance: { source: 'NIrV Adventure Bible', reading: 'Psalms 70' },
  ...companionOf(participation),
});

/** A tracked-quiz unit: `document` names a published print-document artifact. */
const printUnit = (participation) => ({
  unitId: 'quiz-lesson',
  title: 'A tracked quiz',
  subject: 'science',
  courseId: 'chemistry',
  document: PRINT_REF,
  passing: { percent: 80 },
  provenance: { source: 'NIrV Adventure Bible', reading: 'Psalms 70' },
  ...companionOf(participation),
});

function issuer({ unit, logger }) {
  const sessions = new FakeSessionRepository();
  const printer = { jobs: [], async printPdf(bytes, options) { this.jobs.push({ bytes, options }); return { ok: true }; } };
  const companions = { records: [], async put(record) { this.records.push(record); return record; } };
  const legacyDocument = {
    id: 'doc-legacy', title: 'A legacy lesson', variant: 0, blocks: [{ type: 'question', itemId: 'q1', prompt: 'Why?' }],
  };
  const publishedQuiz = {
    id: 'quiz-one', rev: 'abc123def', title: 'A tracked quiz', variant: 0,
    blocks: [{ type: 'question', itemId: 'q1', prompt: 'Why?' }],
  };

  const issueDocument = new IssueDocument({
    curriculum: {
      async getUnit(id) { return id === unit.unitId ? unit : null; },
      async getDocument(id) { return id === 'doc-legacy' ? legacyDocument : null; },
      async listWorks() { return []; },
    },
    sessions,
    tokens: new FakeTokenRegistry({ now: () => NOW }),
    renderer: {
      calls: 0,
      async render() {
        this.calls += 1;
        return renderedPdf('%PDF legacy', { formMap: { formId: 'fm-1', rows: [] } });
      },
    },
    printer,
    formMaps: new FakeFormMapStore(),
    bankReader: { getBank: () => null },
    printDocuments: {
      async getPublished(id, rev) { return id === 'quiz-one' && rev === 'abc123def' ? publishedQuiz : null; },
      async writePublished(source) { return { id: source.id, rev: 'abc123def' }; },
    },
    publishPrintDocument: { async execute({ source }) { return { id: source.id, rev: 'abc123def' }; } },
    renderPrintDocument: {
      async execute() {
        return {
          bytes: Buffer.from('%PDF quiz'), pageCount: 1, duplex: false,
          allocation: { cardId: '7654321', recordId: 'rec-q', rowRange: { start: 1, end: 1 } },
        };
      },
    },
    allocationStore: { async findReusableCard() { return null; }, async release() { return []; } },
    companions,
    // Wired exactly as production wires it — the refusal must NOT depend on a
    // missing store, or it would evaporate the day the store is present.
    companionCodes: {
      keyFor: () => 'cmc_deadbeefdeadbeef',
      async findOrCreate({ create }) { return create(); },
    },
    householdId: 'hh1',
    clock: () => new Date(NOW),
    rng: seededRng(1),
    logger,
  });

  return { issueDocument, sessions, printer, companions };
}

async function issue(unit) {
  const logger = recordingLogger();
  const stack = issuer({ unit, logger });
  await stack.sessions.appendEvent('ses-1', {
    type: 'created', at: NOW, sessionId: 'ses-1', learnerId: 'kid1', unitId: unit.unitId,
  });
  const result = await stack.issueDocument.execute({ sessionId: 'ses-1' });
  return { ...stack, result, logger };
}

describe.each([
  ['the legacy document path', legacyUnit],
  ['the tracked-quiz print-document path', printUnit],
])('IssueDocument — %s cannot carry a gate row', (_label, unitFor) => {
  it('REFUSES a required companion rather than printing a sheet with no gate row', async () => {
    const { result, printer, sessions, logger } = await issue(unitFor('required'));

    expect(result.status).toBe('unavailable');
    // Named for what a grown-up must actually change. These two sheet kinds are
    // ALREADY printed on their own, so "print it on its own" — the fix for a
    // composed batch — would be a lie here: the lesson has to move to a
    // bank-only worksheet, or drop back to `participation: optional`.
    expect(result.message).toBe('This lesson needs a read-along that this kind of sheet cannot check. Tell a grown-up.');
    // Nothing printed, and the session did not advance: the ticket in the
    // child's hand is still good once a grown-up re-authors the lesson.
    expect(printer.jobs).toEqual([]);
    expect(sessions.types('ses-1')).toEqual(['created']);
    // A grown-up who hits this leaves a trace.
    expect(logger.warns.map((entry) => entry.event))
      .toContain('school.issue.companion-gate-unsupported');
  });

  it('still prints an OPTIONAL companion exactly as it always did', async () => {
    const { result, printer, sessions } = await issue(unitFor('optional'));

    expect(result.status).toBe('issued');
    expect(printer.jobs).toHaveLength(1);
    expect(sessions.types('ses-1')).toEqual(['created', 'issued']);
  });

  it('still prints a lesson with NO companion at all', async () => {
    const { result, printer, sessions } = await issue(unitFor(null));

    expect(result.status).toBe('issued');
    expect(printer.jobs).toHaveLength(1);
    expect(sessions.types('ses-1')).toEqual(['created', 'issued']);
  });
});
