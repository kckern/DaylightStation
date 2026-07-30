import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoNowService } from '#apps/donow/DoNowService.mjs';

const NOW_ISO = '2026-07-30T10:00:00.000Z';

const fakeAdapter = (over = {}) => ({
  id: 'garage-fitness',
  validateAction: () => [],
  occupancy: vi.fn(),
  dispatch: vi.fn(),
  label: () => 'dance video in the garage',
  ...over,
});

const fakeDatastore = (over = {}) => ({
  findPending: vi.fn().mockResolvedValue(null),
  putPending: vi.fn().mockResolvedValue(undefined),
  appendDispatch: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const fakeNotifier = () => ({ notify: vi.fn().mockResolvedValue(undefined) });

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

const build = ({ surfaceId = 'garage-fitness', adapter, datastore, notifier, eventBus, ...opts } = {}) => {
  const surf = adapter || fakeAdapter({ id: surfaceId });
  const store = datastore || fakeDatastore();
  const surfaces = new Map([[surfaceId, surf]]);
  const service = new DoNowService({
    surfaces,
    datastore: store,
    notifier: notifier || null,
    eventBus: eventBus || null,
    clock: () => new Date(NOW_ISO),
    newId: () => 'dnr_test1',
    logger: silentLogger,
    ...opts,
  });
  return { service, surf, store };
};

describe('DoNowService.dispatch', () => {
  describe('surface + action validation', () => {
    it('unknown surface -> failed, with a message naming the surface', async () => {
      const { service } = build();
      const result = await service.dispatch({
        surface: 'nonexistent', action: {}, requestedBy: 'api',
      });
      expect(result.decision).toBe('failed');
      expect(result.message).toMatch(/nonexistent/);
    });

    it('validateAction errors -> failed, with the errors in the message', async () => {
      const adapter = fakeAdapter({ validateAction: () => ['episode is required', 'surface is closed'] });
      const { service } = build({ adapter });
      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, requestedBy: 'api',
      });
      expect(result.decision).toBe('failed');
      expect(result.message).toMatch(/episode is required/);
      expect(result.message).toMatch(/surface is closed/);
      expect(adapter.occupancy).not.toHaveBeenCalled();
    });
  });

  describe('pending dedup (spec §4/§9 row 7)', () => {
    it('an unexpired pending row for the same surface+ref returns its approvalId, does NOT call the notifier, and does NOT probe occupancy', async () => {
      const existing = { id: 'dnr_existing', surface: 'garage-fitness', ref: 'ses_1' };
      const datastore = fakeDatastore({ findPending: vi.fn().mockResolvedValue(existing) });
      const notifier = fakeNotifier();
      const adapter = fakeAdapter();
      const { service } = build({ datastore, notifier, adapter });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result).toEqual({ decision: 'pending_approval', approvalId: 'dnr_existing', message: expect.any(String) });
      expect(notifier.notify).not.toHaveBeenCalled();
      expect(adapter.occupancy).not.toHaveBeenCalled();
    });

    it('impatient re-dispatch while pending -> SAME approvalId, notifier called exactly ONCE overall (spec §9 row 7 verbatim)', async () => {
      const datastore = fakeDatastore();
      const notifier = fakeNotifier();
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const { service } = build({ datastore, notifier, adapter });

      // First dispatch: nothing pending yet -> pends for real, notifies once.
      datastore.findPending.mockResolvedValueOnce(null);
      const first = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });
      expect(first.decision).toBe('pending_approval');
      expect(notifier.notify).toHaveBeenCalledTimes(1);

      // Simulate the record now existing (as putPending would have written it).
      const [putRecord] = datastore.putPending.mock.calls[0];
      datastore.findPending.mockResolvedValue(putRecord);

      // Second, impatient re-dispatch with the same surface+ref.
      const second = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(second.decision).toBe('pending_approval');
      expect(second.approvalId).toBe(first.approvalId);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(datastore.putPending).toHaveBeenCalledTimes(1);
    });
  });

  describe('occupancy probe failure (spec §8)', () => {
    it('adapter.occupancy() throwing is treated as unknown -> fail-closed pending_approval', async () => {
      const adapter = fakeAdapter({ occupancy: vi.fn().mockRejectedValue(new Error('sensor offline')) });
      const notifier = fakeNotifier();
      const { service, store } = build({ adapter, notifier });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('pending_approval');
      expect(store.putPending).toHaveBeenCalledTimes(1);
      expect(notifier.notify).toHaveBeenCalledTimes(1);
    });

    it('adapter.occupancy() throwing + force:never_ask -> denied (fail-closed still honors force)', async () => {
      const adapter = fakeAdapter({ occupancy: vi.fn().mockRejectedValue(new Error('sensor offline')) });
      const { service } = build({ adapter });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'cron', ref: 'ses_1', force: 'never_ask',
      });

      expect(result.decision).toBe('denied');
    });
  });

  describe('policy: dispatch', () => {
    it('idle occupancy -> dispatched, calls adapter.dispatch, appends a log row, and broadcasts donow.dispatched', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
        dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
      });
      const eventBus = { broadcast: vi.fn() };
      const { service, store } = build({ adapter, eventBus });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('dispatched');
      expect(adapter.dispatch).toHaveBeenCalledWith({
        action: { episode: 'plex:1' }, learnerId: 'kid1', requestedBy: 'school-scan',
      });
      expect(store.appendDispatch).toHaveBeenCalledTimes(1);
      const [row] = store.appendDispatch.mock.calls[0];
      expect(row).toMatchObject({
        at: NOW_ISO, surface: 'garage-fitness', learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });
      // The IMMEDIATE dispatch path never carries `approved`/`approvalId` —
      // that pair is `dispatchApproved`-only, and is the sole discriminator a
      // subscriber (DoNowSchoolBridge) has for telling the two paths apart.
      expect(eventBus.broadcast).toHaveBeenCalledWith('donow', {
        type: 'donow.dispatched', ref: 'ses_1', surface: 'garage-fitness', requestedBy: 'school-scan',
      });
      expect(eventBus.broadcast.mock.calls[0][1]).not.toHaveProperty('approved');
      expect(eventBus.broadcast.mock.calls[0][1]).not.toHaveProperty('approvalId');
      // log append happens before the broadcast
      const appendOrder = store.appendDispatch.mock.invocationCallOrder[0];
      const broadcastOrder = eventBus.broadcast.mock.invocationCallOrder[0];
      expect(appendOrder).toBeLessThan(broadcastOrder);
    });

    it('active occupancy with occupant === learnerId -> dispatched', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid1' }),
        dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
      });
      const { service } = build({ adapter });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('dispatched');
    });

    it('the dispatch-log row carries programId for requestedBy: "school-program"', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
        dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
      });
      const { service, store } = build({ adapter });

      await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
      });

      const [row] = store.appendDispatch.mock.calls[0];
      expect(row.programId).toBe('pe-daily');
      expect(row.requestedBy).toBe('school-program');
    });

    it('omits programId from the appendDispatch call args when not supplied', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
        dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
      });
      const { service, store } = build({ adapter });

      await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      const [row] = store.appendDispatch.mock.calls[0];
      expect('programId' in row).toBe(false);
    });
  });

  describe('policy: pending_approval', () => {
    it('active occupancy, other occupant, no force -> pending_approval; persists a pending record with label + occupant; notifies once', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const notifier = fakeNotifier();
      const { service, store } = build({ adapter, notifier });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
        requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('pending_approval');
      expect(result.approvalId).toBe('dnr_test1');
      expect(store.putPending).toHaveBeenCalledTimes(1);
      const [record] = store.putPending.mock.calls[0];
      expect(record).toMatchObject({
        id: 'dnr_test1',
        surface: 'garage-fitness',
        action: { episode: 'plex:1' },
        label: 'dance video in the garage',
        learnerId: 'kid1',
        requestedBy: 'school-scan',
        ref: 'ses_1',
        occupant: 'kid2',
        createdAt: NOW_ISO,
      });
      expect(record.expiresAt).toBe('2026-07-30T10:02:00.000Z'); // default TTL 120s
      expect(notifier.notify).toHaveBeenCalledTimes(1);
      expect(notifier.notify).toHaveBeenCalledWith(record);
    });

    it('respects a custom approvalTtlSeconds', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'unknown', occupantId: null }),
      });
      const { service, store } = build({ adapter, approvalTtlSeconds: 30 });

      await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1',
      });

      const [record] = store.putPending.mock.calls[0];
      expect(record.expiresAt).toBe('2026-07-30T10:00:30.000Z');
    });

    it('notifier failure is caught, logged, and the request still pends (result unaffected)', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const notifier = { notify: vi.fn().mockRejectedValue(new Error('HA unreachable')) };
      const errorLog = vi.fn();
      const logger = { ...silentLogger, error: errorLog };
      const { service, store } = build({ adapter, notifier, logger });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('pending_approval');
      expect(result.approvalId).toBe('dnr_test1');
      expect(store.putPending).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalled();
      // A failed notify means nobody was actually told — the slip must not
      // claim otherwise (spec review finding).
      expect(result.message).toMatch(/is busy — ask a grown-up\.$/);
      expect(result.message).not.toMatch(/we asked a grown-up/);
    });

    it('no notifier configured -> still pends without throwing, and is honest that nobody was asked', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const { service } = build({ adapter, notifier: null });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('pending_approval');
      // No notifier configured means nobody was actually asked — the pend
      // still happens (approval via the API/queue remains possible), but
      // the printed slip must say so honestly rather than claiming "we
      // asked a grown-up" (spec review finding).
      expect(result.message).toMatch(/is busy — ask a grown-up\.$/);
      expect(result.message).not.toMatch(/we asked a grown-up/);
    });

    it('notifier configured and successful -> the slip honestly says a grown-up WAS asked', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const notifier = fakeNotifier();
      const { service } = build({ adapter, notifier });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1',
      });

      expect(result.decision).toBe('pending_approval');
      expect(result.message).toMatch(/we asked a grown-up\.$/);
    });
  });

  describe('policy: denied', () => {
    it('active occupancy, other occupant, force: never_ask -> denied with the occupant-free remedy message naming the surface label', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      });
      const { service, store } = build({ adapter });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1',
        requestedBy: 'cron', ref: 'ses_1', force: 'never_ask',
      });

      expect(result.decision).toBe('denied');
      expect(result.message).toBe('The dance video in the garage is busy right now.');
      // The adapter's own label is article-free ('dance video in the
      // garage') — DoNowService's "The {label}" template owns the ONE
      // leading article. A label that supplied its own capitalized article
      // used to double up into "The The dance video in the garage is busy
      // right now." on a child's slip (spec review finding); this guards
      // against that regressing.
      expect(result.message.match(/\bThe /g)).toHaveLength(1);
      expect(store.putPending).not.toHaveBeenCalled();
    });
  });

  describe('adapter.dispatch failure', () => {
    it('adapter.dispatch throwing -> failed, no log row, no broadcast', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
        dispatch: vi.fn().mockRejectedValue(new Error('device unreachable')),
      });
      const eventBus = { broadcast: vi.fn() };
      const { service, store } = build({ adapter, eventBus });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'api', ref: 'ses_1',
      });

      expect(result.decision).toBe('failed');
      expect(store.appendDispatch).not.toHaveBeenCalled();
      expect(eventBus.broadcast).not.toHaveBeenCalled();
    });

    it('adapter.dispatch resolving { dispatched: false } -> failed, no log row', async () => {
      const adapter = fakeAdapter({
        occupancy: vi.fn().mockResolvedValue({ state: 'idle', occupantId: null }),
        dispatch: vi.fn().mockResolvedValue({ dispatched: false, detail: 'busy elsewhere' }),
      });
      const { service, store } = build({ adapter });

      const result = await service.dispatch({
        surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'api', ref: 'ses_1',
      });

      expect(result.decision).toBe('failed');
      expect(store.appendDispatch).not.toHaveBeenCalled();
    });
  });
});

describe('DoNowService.dispatchApproved', () => {
  it('calls adapter.dispatch, appends a log row carrying the original requestedBy/ref/learnerId + approvalId, and broadcasts with the original requestedBy', async () => {
    const adapter = fakeAdapter({
      dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
    });
    const eventBus = { broadcast: vi.fn() };
    const { service, store } = build({ adapter, eventBus });

    const record = {
      id: 'dnr_approved1',
      surface: 'garage-fitness',
      action: { episode: 'plex:1' },
      learnerId: 'kid1',
      requestedBy: 'school-scan',
      ref: 'ses_1',
    };

    const result = await service.dispatchApproved(record);

    expect(result.decision).toBe('dispatched');
    expect(adapter.dispatch).toHaveBeenCalledWith({
      action: { episode: 'plex:1' }, learnerId: 'kid1', requestedBy: 'school-scan',
    });
    expect(store.appendDispatch).toHaveBeenCalledTimes(1);
    const [row] = store.appendDispatch.mock.calls[0];
    expect(row).toMatchObject({
      at: NOW_ISO, surface: 'garage-fitness', decision: 'dispatch',
      learnerId: 'kid1', requestedBy: 'school-scan', ref: 'ses_1', approvalId: 'dnr_approved1',
    });
    expect('programId' in row).toBe(false);
    // approved:true + approvalId are the ONLY discriminator a subscriber has
    // between this out-of-band approval and the immediate dispatch() path
    // (which never sets them) — see DoNowSchoolBridge's ownership filter.
    expect(eventBus.broadcast).toHaveBeenCalledWith('donow', {
      type: 'donow.dispatched', ref: 'ses_1', surface: 'garage-fitness', requestedBy: 'school-scan',
      approved: true, approvalId: 'dnr_approved1',
    });
  });

  it('carries programId from the record through to the dispatch-log row when present', async () => {
    const adapter = fakeAdapter({ dispatch: vi.fn().mockResolvedValue({ dispatched: true }) });
    const { service, store } = build({ adapter });

    const record = {
      id: 'dnr_approved2', surface: 'garage-fitness', action: {}, learnerId: 'kid1',
      requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
    };

    await service.dispatchApproved(record);

    const [row] = store.appendDispatch.mock.calls[0];
    expect(row.programId).toBe('pe-daily');
    expect(row.approvalId).toBe('dnr_approved2');
  });

  it('unregistered surface -> failed, no log row, no broadcast', async () => {
    const eventBus = { broadcast: vi.fn() };
    const { service, store } = build({ eventBus });

    const result = await service.dispatchApproved({
      id: 'dnr_x', surface: 'nonexistent', action: {}, learnerId: 'kid1', requestedBy: 'api', ref: 'r1',
    });

    expect(result).toEqual({ decision: 'failed', message: expect.stringMatching(/nonexistent/) });
    expect(store.appendDispatch).not.toHaveBeenCalled();
    expect(eventBus.broadcast).not.toHaveBeenCalled();
  });

  it('adapter.dispatch declining -> failed, no log row', async () => {
    const adapter = fakeAdapter({ dispatch: vi.fn().mockResolvedValue({ dispatched: false }) });
    const { service, store } = build({ adapter });

    const result = await service.dispatchApproved({
      id: 'dnr_y', surface: 'garage-fitness', action: {}, learnerId: 'kid1', requestedBy: 'api', ref: 'r1',
    });

    expect(result.decision).toBe('failed');
    expect(store.appendDispatch).not.toHaveBeenCalled();
  });
});

describe('DoNowService.occupancyFor', () => {
  it('returns the live adapter probe result', async () => {
    const adapter = fakeAdapter({
      occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
    });
    const { service } = build({ adapter });

    const result = await service.occupancyFor('garage-fitness');

    expect(result).toEqual({ state: 'active', occupantId: 'kid2' });
    expect(adapter.occupancy).toHaveBeenCalledTimes(1);
  });

  it('adapter.occupancy() throwing -> unknown (fail closed)', async () => {
    const adapter = fakeAdapter({ occupancy: vi.fn().mockRejectedValue(new Error('sensor offline')) });
    const { service } = build({ adapter });

    const result = await service.occupancyFor('garage-fitness');

    expect(result).toEqual({ state: 'unknown', occupantId: null });
  });

  it('unregistered surface -> unknown (fail closed), does not throw', async () => {
    const { service } = build();

    const result = await service.occupancyFor('nonexistent');

    expect(result).toEqual({ state: 'unknown', occupantId: null });
  });
});

describe('DoNowService.listSurfaces', () => {
  it('returns ids + human labels only', () => {
    const { service } = build({ adapter: fakeAdapter({ label: () => 'dance video in the garage' }) });

    const result = service.listSurfaces();

    expect(result).toEqual([{ id: 'garage-fitness', label: 'dance video in the garage' }]);
  });

  it('a missing/throwing label() yields a bare { id } row', () => {
    const { service } = build({
      adapter: fakeAdapter({
        label: () => { throw new Error('nope'); },
      }),
    });

    const result = service.listSurfaces();

    expect(result).toEqual([{ id: 'garage-fitness' }]);
  });
});

describe('DoNowService.dispatch — pending record carries programId through to approval (IMPORTANT fix)', () => {
  it('a school-program request that pends persists programId on the pending record; approving it later carries programId through to the dispatch log', async () => {
    const adapter = fakeAdapter({
      occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
      dispatch: vi.fn().mockResolvedValue({ dispatched: true }),
    });
    const { service, store } = build({ adapter });

    const pendResult = await service.dispatch({
      surface: 'garage-fitness', action: { episode: 'plex:1' }, learnerId: 'kid1',
      requestedBy: 'school-program', ref: 'pe-daily', programId: 'pe-daily',
    });

    expect(pendResult.decision).toBe('pending_approval');
    expect(store.putPending).toHaveBeenCalledTimes(1);
    const [pendingRecord] = store.putPending.mock.calls[0];
    expect(pendingRecord.programId).toBe('pe-daily');

    // Approve later (adapter now idle) — the full pend -> approve round trip.
    const result = await service.dispatchApproved(pendingRecord);

    expect(result.decision).toBe('dispatched');
    const [row] = store.appendDispatch.mock.calls[0];
    expect(row.programId).toBe('pe-daily');
    expect(row.approvalId).toBe(pendingRecord.id);
    expect(row.requestedBy).toBe('school-program');
    expect(row.ref).toBe('pe-daily');
  });

  it('a request WITHOUT a programId omits it from the pending record entirely (absent key, not null)', async () => {
    const adapter = fakeAdapter({
      occupancy: vi.fn().mockResolvedValue({ state: 'active', occupantId: 'kid2' }),
    });
    const { service, store } = build({ adapter });

    await service.dispatch({
      surface: 'garage-fitness', action: {}, learnerId: 'kid1',
      requestedBy: 'school-scan', ref: 'ses_1',
    });

    const [record] = store.putPending.mock.calls[0];
    expect('programId' in record).toBe(false);
  });
});
