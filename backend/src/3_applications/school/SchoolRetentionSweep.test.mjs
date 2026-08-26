import { describe, it, expect, vi } from 'vitest';
import { SchoolRetentionSweep } from './SchoolRetentionSweep.mjs';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const silent = { info() {}, warn() {}, error() {} };

describe('SchoolRetentionSweep (admin advocacy A5)', () => {
  it('archives old print-log entries, drops aged denied/pending print rows, keeps the rest', async () => {
    let pending = [
      { id: 'pr_denied_old', status: 'denied', at: daysAgo(60), deniedAt: daysAgo(45) },
      { id: 'pr_denied_new', status: 'denied', at: daysAgo(10), deniedAt: daysAgo(9) },
      { id: 'pr_pending_dead', status: 'pending', at: daysAgo(120) },
      { id: 'pr_pending_live', status: 'pending', at: daysAgo(3) },
    ];
    const ds = {
      archivePrintLogBefore: vi.fn(() => 7),
      readPrintPending: () => pending,
      savePrintPending: vi.fn((next) => { pending = next; }),
    };
    const sweep = new SchoolRetentionSweep({ datastore: ds, now: () => NOW, logger: silent });
    const result = await sweep.execute();
    expect(result).toEqual({ archivedPrintLog: 7, droppedPrintRows: 2, droppedQuizRequests: 0 });
    expect(pending.map((r) => r.id)).toEqual(['pr_denied_new', 'pr_pending_live']);
    expect(ds.archivePrintLogBefore).toHaveBeenCalledWith(daysAgo(180));
  });

  it('drops aged FULFILLED quiz requests but NEVER a retake or flag — those are a child\'s voice', async () => {
    let requests = [
      { at: daysAgo(60), userId: 'learner4', unitId: 'plex:1' },          // fulfilled + old -> drop
      { at: daysAgo(5), userId: 'learner4', unitId: 'plex:2' },           // fulfilled + fresh -> keep
      { at: daysAgo(400), userId: 'learner3', unitId: 'plex:9' },          // NOT fulfilled -> keep forever
      { at: daysAgo(400), kind: 'retake', userId: 'learner4', bankId: 'b' }, // kind -> never swept
      { at: daysAgo(400), kind: 'flag', userId: 'learner3', bankId: 'b' },    // kind -> never swept
    ];
    const ds = {
      readPrintPending: () => [],
      savePrintPending: vi.fn(),
      readQuizRequests: () => requests,
      saveQuizRequests: vi.fn((next) => { requests = next; }),
    };
    const schoolService = {
      warmBanks: vi.fn(async () => {}),
      listQuizRequests: () => [
        { at: daysAgo(60), userId: 'learner4', unitId: 'plex:1', fulfilled: true },
        { at: daysAgo(5), userId: 'learner4', unitId: 'plex:2', fulfilled: true },
        { at: daysAgo(400), userId: 'learner3', unitId: 'plex:9', fulfilled: false },
      ],
    };
    const sweep = new SchoolRetentionSweep({ datastore: ds, schoolService, now: () => NOW, logger: silent });
    const result = await sweep.execute();
    expect(result.droppedQuizRequests).toBe(1);
    expect(requests.map((r) => r.unitId ?? r.bankId)).toEqual(['plex:2', 'plex:9', 'b', 'b']);
  });

  it('a datastore without the newer methods degrades to a zero-work sweep, never a crash', async () => {
    const sweep = new SchoolRetentionSweep({ datastore: {}, now: () => NOW, logger: silent });
    await expect(sweep.execute()).resolves.toEqual({ archivedPrintLog: 0, droppedPrintRows: 0, droppedQuizRequests: 0 });
  });
});
