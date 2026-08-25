/**
 * Regression coverage for the print-cooldown debounce (spec: a household
 * print quota, not a paper factory — see IssueDocument's own header comment
 * and `sessionEvents.mjs`'s `issued`/`reprinted` SCHEMA doc).
 *
 * THE BUG: `IssueDocument` armed `state.lastPrintedAt` — and therefore the
 * `printCooldownMinutes` debounce — the moment the injected `printer.printPdf()`
 * call resolved without throwing. That is "the port accepted this call," not
 * "a sheet came out of a physical printer": `cli/barcode-scan-sim.cli.mjs`'s
 * own `capturingPrinter()` is a real, shipped example of a printer double
 * that resolves successfully while sending nothing anywhere (by design — see
 * that function's doc comment, "dry run by default"). Before the fix below,
 * running that simulator against a session — or any other caller wiring a
 * capture-only printer for preview/testing — silently armed the SAME
 * cooldown a real household scan uses, so the next REAL print could be
 * refused `status: 'debounced'` for a sheet nobody ever actually printed.
 *
 * THE FIX: `printer.printPdf()` may resolve `{ confirmed: false }` to say "I
 * did not send this anywhere real." `IssueDocument#printConfirmed` reads
 * that (defaulting to confirmed for every existing adapter/double that has
 * never heard of the field — see `#printConfirmed`'s own doc comment) and
 * threads it onto the `issued`/`reprinted` event; `sessionEvents.mjs`'s
 * reducer only stamps `lastPrintedAt` when `confirmed !== false`.
 *
 * This suite exercises the LEGACY (non-bank, non-card) issuing path
 * deliberately — it is the simplest of `IssueDocument`'s three success
 * branches to set up, and all three route through the identical
 * `#printConfirmed`/`createEvent({confirmed})` shape, so proving it here
 * proves the mechanism, not just one branch's wiring.
 */
import { describe, it, expect } from 'vitest';
import { IssueDocument } from './IssueDocument.mjs';
import { createEvent, reduceSession } from '#domains/school/sessions/sessionEvents.mjs';
import {
  FakeSessionRepository, FakeTokenRegistry, FakeFormMapStore, FakeDocumentRenderer,
  fakeClock, silentLogger,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

/** A curriculum double resolving exactly one legacy unit -> one legacy document. */
function fakeCurriculum() {
  return {
    async getUnit(unitId) {
      return unitId === 'u1' ? { unitId: 'u1', document: 'doc1' } : null;
    },
    async getDocument(documentId) {
      return documentId === 'doc1' ? { id: 'doc1', title: 'Debounce fixture', blocks: [] } : null;
    },
  };
}

/** A printer double whose EVERY call resolves with the given `confirmed` value — never throws. */
function scriptedPrinter(confirmed) {
  const jobs = [];
  return {
    jobs,
    async printPdf(pdf, opts) {
      jobs.push({ pdf, opts });
      return { ok: true, confirmed };
    },
  };
}

async function buildAndCreateSession({ printer, clock }) {
  const sessions = new FakeSessionRepository();
  const artifactRecords = new Map();
  const issuedArtifacts = {
    get: async (id) => artifactRecords.get(id) ?? null,
    put: async (artifact) => {
      const retained = { manifest: { artifactId: artifact.artifactId, pageCount: artifact.pageCount, renderContext: artifact.renderContext }, bytes: Buffer.from(artifact.bytes) };
      artifactRecords.set(artifact.artifactId, retained);
      return retained;
    },
  };
  const issueDocument = new IssueDocument({
    curriculum: fakeCurriculum(),
    sessions,
    tokens: new FakeTokenRegistry(),
    renderer: new FakeDocumentRenderer(),
    printer,
    formMaps: new FakeFormMapStore(),
    issuedArtifacts,
    clock: clock.now,
    logger: silentLogger,
  });
  const sessionId = 'ses_debounce';
  await sessions.appendEvent(sessionId, {
    type: 'created', at: clock.iso(), sessionId, learnerId: 'kid1', unitId: 'u1',
  });
  return { issueDocument, sessions, sessionId };
}

describe('IssueDocument — print-cooldown arms from a CONFIRMED print, not from mere issuance', () => {
  it('an UNCONFIRMED print (printer.printPdf resolves confirmed:false) does not arm the cooldown — the very next rescan still prints', async () => {
    const clock = fakeClock();
    const printer = scriptedPrinter(false); // e.g. the CLI's capturingPrinter — a dry run
    const { issueDocument, sessionId } = await buildAndCreateSession({ printer, clock });

    const first = await issueDocument.execute({ sessionId });
    expect(first.status).toBe('issued');
    expect(printer.jobs).toHaveLength(1);

    // Well inside the default 10-minute cooldown window.
    clock.advanceMs(2 * 60_000);
    const second = await issueDocument.execute({ sessionId });

    // A CONFIRMED-print bug would have silently returned `status: 'debounced'`
    // here with no second print job — exactly the "refused 'debounced' with
    // nothing having actually come out" failure this test exists to catch.
    expect(second.status).toBe('reprinted');
    expect(printer.jobs).toHaveLength(2);
  });

  it('a CONFIRMED print (the ordinary case — printer.printPdf resolves with no confirmed field) still arms the cooldown exactly as before', async () => {
    const clock = fakeClock();
    const printer = scriptedPrinter(undefined); // real LaserPrinterAdapter/FakeLaserPrinter shape: no `confirmed` key at all
    const { issueDocument, sessionId } = await buildAndCreateSession({ printer, clock });

    const first = await issueDocument.execute({ sessionId });
    expect(first.status).toBe('issued');

    clock.advanceMs(2 * 60_000); // still inside the cooldown
    const second = await issueDocument.execute({ sessionId });
    expect(second.status).toBe('debounced');
    expect(printer.jobs).toHaveLength(1); // no second job was ever sent

    clock.advanceMs(9 * 60_000); // now 11 minutes past the first print — outside the 10-minute default
    const third = await issueDocument.execute({ sessionId });
    expect(third.status).toBe('reprinted');
    expect(printer.jobs).toHaveLength(2);
  });

  it('sessionEvents reducer: an `issued` event with confirmed:false leaves lastPrintedAt at whatever it was before (null on a fresh session)', () => {
    const { errors, event } = createEvent({
      type: 'issued', at: '2026-08-14T10:00:00.000Z', sessionId: 's1', artifactId: 'art-1', confirmed: false, seq: 2,
    });
    expect(errors).toEqual([]);
    const state = reduceSession([
      {
        type: 'created', at: '2026-08-14T09:00:00.000Z', sessionId: 's1', learnerId: 'kid1', unitId: 'u1', seq: 1,
      },
      event,
    ]);
    expect(state.issuedArtifacts).toEqual(['art-1']); // lineage/state still advances
    expect(state.lastPrintedAt).toBeNull(); // but the cooldown never armed
  });
});
