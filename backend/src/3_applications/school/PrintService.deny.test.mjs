/**
 * Deny keeps the record (student advocacy, wave 7): a denied print request
 * stays in the store as a `denied` row — the child who asked can see the
 * outcome instead of watching their request vanish — and listRequestsFor
 * answers one learner's own asks, newest first. Old denied rows age out.
 */
import { describe, it, expect, vi } from 'vitest';
import { PrintService } from './PrintService.mjs';

const NOW = Date.parse('2026-08-06T18:00:00.000Z');

function makeService({ pending }) {
  let rows = pending;
  const ds = {
    readPrintPending: () => rows,
    savePrintPending: vi.fn((next) => { rows = next; }),
    appendPrintLog: vi.fn(),
    readPrintLog: () => [],
  };
  const svc = new PrintService({
    config: {},
    datastore: ds,
    printerAdapter: { print: vi.fn() },
    worksheetRenderer: null,
    bankReader: null,
    pdfReader: null,
    userService: {
      getProfile: (id) => ({ id, birthyear: id === 'dad' ? 1980 : 2016 }),
      getHouseholdRoster: () => [{ id: 'dad', birthyear: 1980 }, { id: 'learner4', birthyear: 2016 }, { id: 'learner3', birthyear: 2018 }],
    },
    logger: { info() {}, warn() {}, error() {} },
    now: () => NOW,
  });
  return { svc, ds, rows: () => rows };
}

describe('PrintService.deny keeps a denied record', () => {
  it('marks the row denied with provenance instead of deleting it', async () => {
    const { svc, rows } = makeService({ pending: [
      { id: 'pr_1', at: '2026-08-06T17:00:00.000Z', userId: 'learner4', label: 'Maze', status: 'pending' },
    ] });
    await expect(svc.deny({ requestId: 'pr_1', approver: 'dad' })).resolves.toEqual({ decision: 'denied' });
    expect(rows()).toEqual([{
      id: 'pr_1', at: '2026-08-06T17:00:00.000Z', userId: 'learner4', label: 'Maze',
      status: 'denied', deniedBy: 'dad', deniedAt: new Date(NOW).toISOString(),
    }]);
  });

  it('prunes denied rows older than 30 days on the same write; pending rows never age out', async () => {
    const { svc, rows } = makeService({ pending: [
      { id: 'pr_old', at: '2026-06-01T00:00:00.000Z', userId: 'learner4', status: 'denied', deniedAt: '2026-06-02T00:00:00.000Z' },
      { id: 'pr_stale', at: '2026-05-01T00:00:00.000Z', userId: 'learner3', status: 'pending' },
      { id: 'pr_2', at: '2026-08-06T17:30:00.000Z', userId: 'learner4', status: 'pending' },
    ] });
    await svc.deny({ requestId: 'pr_2', approver: 'dad' });
    const ids = rows().map((r) => r.id);
    expect(ids).toEqual(['pr_stale', 'pr_2']); // pr_old aged out; pending survives
  });

  it('listRequestsFor answers only that learner, newest first', () => {
    const { svc } = makeService({ pending: [
      { id: 'pr_a', at: '2026-08-01T00:00:00.000Z', userId: 'learner4', status: 'denied', deniedAt: '2026-08-01T01:00:00.000Z' },
      { id: 'pr_b', at: '2026-08-06T00:00:00.000Z', userId: 'learner4', status: 'pending' },
      { id: 'pr_c', at: '2026-08-05T00:00:00.000Z', userId: 'learner3', status: 'pending' },
    ] });
    expect(svc.listRequestsFor('learner4').map((r) => r.id)).toEqual(['pr_b', 'pr_a']);
  });
});
