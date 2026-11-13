import { describe, it, expect, vi } from 'vitest';
import { RecordPrintedActivityScan } from './RecordPrintedActivityScan.mjs';

const KEY = { platform: 'beeloo', externalId: 'page-123' };

function issuance(overrides = {}) {
  return {
    issuanceId: 'iss-1', learnerId: 'learner_a', programId: 'printed-activity', corpusId: 'mazes',
    platform: 'beeloo', externalId: 'page-123', title: 'Maze 12', kind: 'Maze', level: 2,
    issuedAt: '2026-11-10T18:00:00.000Z', issuedStudyDay: '2026-11-10',
    completedAt: null, completedStudyDay: null, completedVia: null, voidedAt: null, voidReason: null,
    ...overrides,
  };
}

/** In-memory store honouring the port's open/any/complete answers. */
function fakeStore(rows = []) {
  const calls = { findOpen: 0, findAny: 0, complete: [] };
  const match = (r, k) => r.platform === k.platform && r.externalId === k.externalId;
  return {
    calls,
    rows,
    async findOpen(k) { calls.findOpen += 1; return rows.find((r) => match(r, k) && !r.completedAt && !r.voidedAt) ?? null; },
    async findAny(k) { calls.findAny += 1; return [...rows].reverse().find((r) => match(r, k)) ?? null; },
    async complete(learnerId, issuanceId, { at, studyDay, device }) {
      calls.complete.push({ learnerId, issuanceId, at, studyDay, device });
      const row = rows.find((r) => r.learnerId === learnerId && r.issuanceId === issuanceId);
      if (!row) return { status: 'missing', issuance: null };
      if (row.voidedAt) return { status: 'voided', issuance: row };
      if (row.completedAt) return { status: 'already', issuance: row };
      Object.assign(row, { completedAt: at, completedStudyDay: studyDay, completedVia: device });
      return { status: 'completed', issuance: row };
    },
  };
}

function fakeReceipts(answer = { printed: true }) {
  const docs = [];
  return {
    docs,
    async print(doc) { docs.push(doc); if (answer instanceof Error) throw answer; return answer; },
  };
}

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const enrolled = { get: async () => ({ programs: [{ programId: 'printed-activity', corpusId: 'mazes' }] }) };

function build({
  store = fakeStore([issuance()]), receipts = fakeReceipts(), assignments = enrolled,
  learnerName = (id) => (id === 'learner_a' ? 'Learner A' : null),
  now = '2026-11-14T18:00:00Z', timezone = 'America/Los_Angeles', logger = fakeLogger(),
} = {}) {
  const uc = new RecordPrintedActivityScan({
    store, receipts, assignments, learnerName, timezone, clock: () => new Date(now), logger,
  });
  return { uc, store, receipts, logger };
}

const docText = (doc) => JSON.stringify(doc);
const logged = (fn, event) => fn.mock.calls.filter(([e]) => e === event);

describe('RecordPrintedActivityScan', () => {
  it('requires store, receipts, clock and logger', () => {
    const base = { store: fakeStore(), receipts: fakeReceipts(), clock: () => new Date(), logger: fakeLogger() };
    for (const k of ['store', 'receipts', 'clock', 'logger']) {
      expect(() => new RecordPrintedActivityScan({ ...base, [k]: undefined })).toThrow();
    }
    expect(() => new RecordPrintedActivityScan(base)).not.toThrow();
  });

  it('records an open issuance on the study day of the scan, with the device', async () => {
    const { uc, store, receipts, logger } = build();
    const out = await uc.execute({ ...KEY, device: 'kitchen-scanner' });
    expect(out).toMatchObject({
      status: 'recorded', ok: true, message: "Learner A's maze counted", printed: true,
      learnerId: 'learner_a', issuanceId: 'iss-1',
    });
    expect(store.calls.complete).toEqual([{
      learnerId: 'learner_a', issuanceId: 'iss-1', at: '2026-11-14T18:00:00.000Z',
      studyDay: '2026-11-14', device: 'kitchen-scanner',
    }]);
    expect(receipts.docs).toHaveLength(1);
    expect(docText(receipts.docs[0])).toContain("Learner A's maze counted");
    expect(docText(receipts.docs[0])).toContain('Maze 12');
    expect(logged(logger.info, 'school.printed-activity.scanned')[0][1]).toEqual({
      learnerId: 'learner_a', corpusId: 'mazes', platform: 'beeloo', externalId: 'page-123',
      studyDay: '2026-11-14', device: 'kitchen-scanner',
    });
    expect(logged(logger.warn, 'school.printed-activity.scan-orphaned')).toHaveLength(0);
  });

  it('credits a 03:30 local scan to the previous study day (4am boundary)', async () => {
    const { uc, store } = build({ now: '2026-11-14T11:30:00Z' });
    const out = await uc.execute(KEY);
    expect(out.status).toBe('recorded');
    expect(store.calls.complete[0].studyDay).toBe('2026-11-13');
  });

  it('a second scan of the same sheet says already counted and completes nothing', async () => {
    const store = fakeStore([issuance({ completedAt: '2026-11-12T20:00:00.000Z', completedStudyDay: '2026-11-12' })]);
    const { uc, receipts } = build({ store });
    const out = await uc.execute(KEY);
    expect(out).toMatchObject({ status: 'already', ok: true, message: 'Already counted', learnerId: 'learner_a' });
    expect(store.calls.complete).toHaveLength(0);
    expect(docText(receipts.docs[0])).toContain("Learner A's Maze 12 was counted on 2026-11-12.");
  });

  it('a concurrent scan that lost the race says already counted', async () => {
    const store = fakeStore([issuance()]);
    const done = issuance({ completedAt: '2026-11-14T17:59:59.000Z', completedStudyDay: '2026-11-14' });
    store.complete = vi.fn(async () => ({ status: 'already', issuance: done }));
    const { uc, receipts } = build({ store });
    const out = await uc.execute(KEY);
    expect(out).toMatchObject({ status: 'already', ok: true, message: 'Already counted' });
    expect(store.complete).toHaveBeenCalledTimes(1);
    expect(docText(receipts.docs[0])).toContain('was counted on 2026-11-14.');
  });

  it('a page School never issued is not a School sheet, nothing written', async () => {
    const store = fakeStore([]);
    const { uc, receipts, logger } = build({ store });
    const out = await uc.execute({ ...KEY, device: 'kitchen-scanner' });
    expect(out).toMatchObject({ status: 'not-issued', ok: false, message: 'Not a School sheet' });
    expect(store.calls.complete).toHaveLength(0);
    expect(docText(receipts.docs[0])).toContain("This page wasn't printed by School, so it doesn't count.");
    expect(logged(logger.info, 'school.printed-activity.scan-unmatched')[0][1]).toEqual({
      platform: 'beeloo', externalId: 'page-123', device: 'kitchen-scanner',
    });
  });

  it('a voided page is not counted', async () => {
    const store = fakeStore([issuance({ voidedAt: '2026-11-10T18:00:05.000Z', voidReason: 'print_failed' })]);
    const { uc, receipts } = build({ store });
    const out = await uc.execute(KEY);
    expect(out).toMatchObject({ status: 'voided', ok: false, message: 'Not counted' });
    expect(store.calls.complete).toHaveLength(0);
    expect(docText(receipts.docs[0])).toContain('This sheet was cancelled when it was printed. Print a new one.');
  });

  it('complete answering voided or missing is not counted, with a warn log', async () => {
    for (const status of ['voided', 'missing']) {
      const store = fakeStore([issuance()]);
      store.complete = async () => ({ status, issuance: null });
      const { uc, logger } = build({ store });
      const out = await uc.execute(KEY);
      expect(out).toMatchObject({ status, ok: false, message: 'Not counted' });
      expect(logged(logger.warn, 'school.printed-activity.scan-refused')).toHaveLength(1);
    }
  });

  it('a removed assignment entry still credits and logs the orphan', async () => {
    const { uc, store, logger } = build({ assignments: { get: async () => ({ programs: [] }) } });
    const out = await uc.execute(KEY);
    expect(out.status).toBe('recorded');
    expect(store.rows[0].completedStudyDay).toBe('2026-11-14');
    expect(logged(logger.warn, 'school.printed-activity.scan-orphaned')[0][1]).toEqual({
      learnerId: 'learner_a', corpusId: 'mazes', issuanceId: 'iss-1',
    });
  });

  it('an assignments read failure is logged and the credit stands', async () => {
    const { uc, logger } = build({ assignments: { get: async () => { throw new Error('disk'); } } });
    const out = await uc.execute(KEY);
    expect(out).toMatchObject({ status: 'recorded', ok: true });
    expect(logged(logger.warn, 'school.printed-activity.assignment-unreadable')).toHaveLength(1);
  });

  it('a store failure answers failed, logs an error, prints a slip and never throws', async () => {
    const store = fakeStore([]);
    store.findOpen = async () => { throw new Error('boom'); };
    const { uc, receipts, logger } = build({ store });
    const out = await uc.execute(KEY);
    expect(out).toEqual({
      status: 'failed', ok: false, message: 'That scan could not be recorded. Ask a grown-up.', printed: true,
    });
    expect(logged(logger.error, 'school.printed-activity.scan-failed')[0][1]).toMatchObject({ error: 'boom' });
    expect(receipts.docs).toHaveLength(1);
  });

  it('a printer that throws or does not print costs the slip, not the credit', async () => {
    for (const receipts of [fakeReceipts(new Error('jam')), fakeReceipts({ printed: false, reason: 'not_wired' })]) {
      const { uc, store } = build({ receipts });
      const out = await uc.execute(KEY);
      expect(out).toMatchObject({ status: 'recorded', ok: true, printed: false });
      expect(store.calls.complete).toHaveLength(1);
    }
  });

  it('invalid input answers invalid without touching the store or printer', async () => {
    for (const bad of [{}, { platform: 'beeloo' }, { platform: '', externalId: 'x' }, { platform: 'beeloo', externalId: 7 }]) {
      const { uc, store, receipts } = build();
      const out = await uc.execute(bad);
      expect(out).toMatchObject({ status: 'invalid', ok: false, printed: false });
      expect(store.calls).toEqual({ findOpen: 0, findAny: 0, complete: [] });
      expect(receipts.docs).toHaveLength(0);
    }
  });

  it('falls back to the learner id when no name is known or the lookup throws', async () => {
    for (const learnerName of [() => null, () => { throw new Error('nope'); }, null]) {
      const { uc } = build({ learnerName });
      const out = await uc.execute(KEY);
      expect(out.message).toBe("learner_a's maze counted");
    }
  });
});
