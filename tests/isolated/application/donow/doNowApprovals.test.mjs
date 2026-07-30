import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoNowApprovals } from '#apps/donow/DoNowApprovals.mjs';

const NOW_ISO = '2026-07-30T10:05:00.000Z';

const baseRecord = (over = {}) => ({
  id: 'dnr_test1',
  surface: 'garage-fitness',
  action: { episode: 'plex:1' },
  label: 'Dance video in the garage',
  learnerId: 'kid1',
  requestedBy: 'school-scan',
  ref: 'ses_1',
  occupant: 'kid2',
  createdAt: '2026-07-30T10:00:00.000Z',
  expiresAt: '2026-07-30T10:02:00.000Z', // 120s TTL
  ...over,
});

/** A tiny mutable pending store — mirrors YamlDoNowDatastore's public shape. */
function fakeDatastore(rows = []) {
  let store = [...rows];
  return {
    listPending: vi.fn(async () => [...store]),
    putPending: vi.fn(async (record) => {
      const idx = store.findIndex((r) => r.id === record.id);
      if (idx >= 0) store[idx] = record; else store.push(record);
      return record;
    }),
    removePending: vi.fn(async (id) => {
      store = store.filter((r) => r.id !== id);
    }),
  };
}

const fakeService = (over = {}) => ({
  occupancyFor: vi.fn(),
  dispatchApproved: vi.fn(),
  ...over,
});

const fakeNotifier = () => ({ notify: vi.fn().mockResolvedValue(undefined) });
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const build = ({ rows, service, notifier, ...opts } = {}) => {
  const datastore = fakeDatastore(rows ?? [baseRecord()]);
  const svc = service || fakeService();
  const approvals = new DoNowApprovals({
    service: svc,
    datastore,
    notifier: notifier || null,
    clock: () => new Date(NOW_ISO),
    logger: silentLogger,
    ...opts,
  });
  return { approvals, datastore, service: svc };
};

describe('DoNowApprovals.approve', () => {
  it('idle occupancy -> dispatched: calls service.dispatchApproved with the record, removes it from pending', async () => {
    const service = fakeService({
      occupancyFor: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
      dispatchApproved: vi.fn().mockResolvedValue({ decision: 'dispatched', message: 'Starting the Dance video in the garage now.' }),
    });
    const { approvals, datastore } = build({ service });

    const result = await approvals.approve({ id: 'dnr_test1' });

    expect(result).toEqual({ decision: 'dispatched', message: 'Starting the Dance video in the garage now.' });
    expect(service.occupancyFor).toHaveBeenCalledWith('garage-fitness');
    expect(service.dispatchApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 'dnr_test1', surface: 'garage-fitness' }));
    expect(datastore.removePending).toHaveBeenCalledWith('dnr_test1');
  });

  it('occupant === the pending record\'s named occupant -> dispatched (exactly what was approved)', async () => {
    const service = fakeService({
      occupancyFor: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      dispatchApproved: vi.fn().mockResolvedValue({ decision: 'dispatched', message: 'Starting now.' }),
    });
    const { approvals, datastore } = build({ service });

    const result = await approvals.approve({ id: 'dnr_test1' });

    expect(result.decision).toBe('dispatched');
    expect(datastore.removePending).toHaveBeenCalledWith('dnr_test1');
  });

  it('a NEW occupant -> re-pends ONCE (record updated, notifier called once more); a second flip -> denied', async () => {
    const service = fakeService({
      occupancyFor: vi.fn(),
      dispatchApproved: vi.fn(),
    });
    const notifier = fakeNotifier();
    const { approvals, datastore } = build({ service, notifier });

    // First approve: a different occupant than the one the parent was told about.
    service.occupancyFor.mockResolvedValueOnce({ state: 'active', occupantId: 'kid3' });
    const first = await approvals.approve({ id: 'dnr_test1' });

    expect(first).toEqual({
      decision: 'pending_approval',
      message: expect.any(String),
    });
    expect(service.dispatchApproved).not.toHaveBeenCalled();
    expect(datastore.removePending).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    const [notified] = notifier.notify.mock.calls[0];
    expect(notified).toMatchObject({ id: 'dnr_test1', repended: true, occupant: 'kid3' });
    expect(notified.expiresAt).toBe('2026-07-30T10:07:00.000Z'); // now + original 120s TTL

    // Second approve, ANOTHER occupant flip -> denied (repended already true).
    service.occupancyFor.mockResolvedValueOnce({ state: 'active', occupantId: 'kid4' });
    const second = await approvals.approve({ id: 'dnr_test1' });

    expect(second.decision).toBe('denied');
    expect(service.dispatchApproved).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledTimes(1); // still just once overall
    expect(datastore.removePending).toHaveBeenCalledWith('dnr_test1');
  });

  it('unknown/expired id -> expired, with a friendly message', async () => {
    const { approvals } = build({ rows: [] });

    const result = await approvals.approve({ id: 'nonexistent' });

    expect(result.decision).toBe('expired');
    expect(result.message).toMatch(/expired|handled/i);
  });

  it('double-approve is idempotent: the first call settles it, the second reads "expired"', async () => {
    const service = fakeService({
      occupancyFor: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
      dispatchApproved: vi.fn().mockResolvedValue({ decision: 'dispatched', message: 'Starting now.' }),
    });
    const { approvals } = build({ service });

    const first = await approvals.approve({ id: 'dnr_test1' });
    expect(first.decision).toBe('dispatched');
    expect(service.dispatchApproved).toHaveBeenCalledTimes(1);

    const second = await approvals.approve({ id: 'dnr_test1' });
    expect(second.decision).toBe('expired');
    // The adapter is never asked to dispatch twice for the same approval.
    expect(service.dispatchApproved).toHaveBeenCalledTimes(1);
  });

  it('adapter-side dispatch failure at approve time -> denied, and the pending record is cleared (not retried)', async () => {
    const service = fakeService({
      occupancyFor: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
      dispatchApproved: vi.fn().mockResolvedValue({ decision: 'failed', message: 'Could not start the Dance video in the garage.' }),
    });
    const { approvals, datastore } = build({ service });

    const result = await approvals.approve({ id: 'dnr_test1' });

    expect(result).toEqual({ decision: 'denied', message: 'Could not start the Dance video in the garage.' });
    expect(datastore.removePending).toHaveBeenCalledWith('dnr_test1');
  });
});

describe('DoNowApprovals.deny', () => {
  it('removes the pending record and returns denied', async () => {
    const { approvals, datastore } = build();

    const result = await approvals.deny({ id: 'dnr_test1' });

    expect(result.decision).toBe('denied');
    expect(datastore.removePending).toHaveBeenCalledWith('dnr_test1');
  });

  it('unknown/expired id -> expired', async () => {
    const { approvals } = build({ rows: [] });

    const result = await approvals.deny({ id: 'nonexistent' });

    expect(result.decision).toBe('expired');
  });
});

describe('DoNowApprovals.listPending', () => {
  it('delegates to the datastore', async () => {
    const rows = [baseRecord()];
    const { approvals, datastore } = build({ rows });

    const result = await approvals.listPending();

    expect(result).toEqual(rows);
    expect(datastore.listPending).toHaveBeenCalled();
  });
});
