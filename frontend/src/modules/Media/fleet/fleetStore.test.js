import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFleetStore } from './fleetStore.js';

vi.mock('../logging/mediaLog.js', () => {
  const stub = new Proxy({}, { get: (t, k) => (t[k] ??= vi.fn()) });
  return { default: stub, mediaLog: stub };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const snap = (state) => ({ state, currentItem: null, position: 0 });

describe('fleetStore', () => {
  it('receive stores the entry and notifies device + all subscribers', () => {
    const store = createFleetStore();
    const onDevice = vi.fn();
    const onAll = vi.fn();
    store.subscribeDevice('tv', onDevice);
    store.subscribeAll(onAll);
    store.receive({ deviceId: 'tv', snapshot: snap('playing'), reason: 'change', ts: 't1' });
    expect(store.getEntry('tv')).toMatchObject({ offline: false, isStale: false, reason: 'change' });
    expect(onDevice).toHaveBeenCalledTimes(1);
    expect(onAll).toHaveBeenCalledTimes(1);
  });

  it('per-device granularity: other devices are not notified', () => {
    const store = createFleetStore();
    const onTv = vi.fn();
    const onKitchen = vi.fn();
    store.subscribeDevice('tv', onTv);
    store.subscribeDevice('kitchen', onKitchen);
    store.receive({ deviceId: 'tv', snapshot: snap('playing') });
    expect(onTv).toHaveBeenCalledTimes(1);
    expect(onKitchen).not.toHaveBeenCalled();
  });

  it('offline broadcasts keep the last snapshot and flag offline', () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'tv', snapshot: snap('playing') });
    store.receive({ deviceId: 'tv', snapshot: null, reason: 'offline' });
    const entry = store.getEntry('tv');
    expect(entry.offline).toBe(true);
    expect(entry.snapshot).toMatchObject({ state: 'playing' });
  });

  it('a device goes stale when heartbeats stop; fresh broadcasts clear it', () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'tv', snapshot: snap('playing') });
    vi.advanceTimersByTime(16_000);
    expect(store.getEntry('tv').isStale).toBe(true);
    store.receive({ deviceId: 'tv', snapshot: snap('playing') });
    expect(store.getEntry('tv').isStale).toBe(false);
  });

  it('heartbeats keep the stale timer at bay', () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'tv', snapshot: snap('playing') });
    vi.advanceTimersByTime(10_000);
    store.receive({ deviceId: 'tv', snapshot: snap('playing'), reason: 'heartbeat' });
    vi.advanceTimersByTime(10_000);
    expect(store.getEntry('tv').isStale).toBe(false);
  });

  it('markAllStale flags every entry', () => {
    const store = createFleetStore();
    store.receive({ deviceId: 'a', snapshot: snap('playing') });
    store.receive({ deviceId: 'b', snapshot: snap('idle') });
    store.markAllStale();
    expect(store.getEntry('a').isStale).toBe(true);
    expect(store.getEntry('b').isStale).toBe(true);
  });

  it('getAll returns a new Map identity per change (useSyncExternalStore)', () => {
    const store = createFleetStore();
    const before = store.getAll();
    store.receive({ deviceId: 'tv', snapshot: snap('idle') });
    expect(store.getAll()).not.toBe(before);
  });

  it('ignores broadcasts without a deviceId', () => {
    const store = createFleetStore();
    store.receive({ snapshot: snap('playing') });
    expect(store.getAll().size).toBe(0);
  });
});
