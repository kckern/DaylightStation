import { describe, it, expect } from 'vitest';
import { buildPairRequest, buildRemoveRequest, buildScanRequest, buildInventoryRequest, mergePairingProgress, mergeScanProgress, scanSilenceReason, PAIR_WINDOW_MS, SCAN_WINDOW_MS } from "./fitnessBtActions.js";

describe('fitnessBtActions', () => {
  it('builds a bt.pair.request with requestId + duration + targets', () => {
    const targets = [{ id: '8bitdo_sfc30', name: '8bitdo', macPrefix: 'E4:17:D8', pin: '0000' }];
    expect(buildPairRequest({ requestId: 'p1', durationMs: 30000, targets }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p1', durationMs: 30000, targets, mode: 'repair' });
  });
  it('defaults durationMs to the pairing window and targets to []', () => {
    expect(buildPairRequest({ requestId: 'p2' }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p2', durationMs: PAIR_WINDOW_MS, targets: [], mode: 'repair' });
  });
  it('buildPairRequest: repair (default) or address with the address; add and unknown modes are repair', () => {
    expect(buildPairRequest({ requestId: 'r' }).mode).toBe('repair');
    expect(buildPairRequest({ requestId: 'r', mode: 'add' }).mode).toBe('repair');
    expect(buildPairRequest({ requestId: 'r', mode: 'bogus' }).mode).toBe('repair');
    expect(buildPairRequest({ requestId: 'r', mode: 'address', address: 'aa:bb:cc:11:22:33', targets: [{ id: null, label: 'R1' }] }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'r', durationMs: PAIR_WINDOW_MS, targets: [{ id: null, label: 'R1' }], mode: 'address', address: 'AA:BB:CC:11:22:33' });
  });
  it('buildScanRequest and buildInventoryRequest', () => {
    expect(buildScanRequest({ requestId: 's' })).toEqual({ topic: 'bt.scan.request', requestId: 's', action: 'start', durationMs: SCAN_WINDOW_MS });
    expect(buildScanRequest({ requestId: 's', action: 'stop' })).toEqual({ topic: 'bt.scan.request', requestId: 's', action: 'stop' });
    expect(buildInventoryRequest({ requestId: 'i' })).toEqual({ topic: 'bt.inventory.request', requestId: 'i' });
  });
  it('mergePairingProgress keeps mode, device and error code across one request', () => {
    const cur = { phase: 'scanning', requestId: 'p1', mode: 'address', optimistic: true, device: { address: 'AA:BB:CC:11:22:33' } };
    const found = mergePairingProgress(cur, { phase: 'found', requestId: 'p1', device: { address: 'AA:BB:CC:11:22:33', name: 'R1' } });
    expect(found.mode).toBe('address');
    const err = mergePairingProgress(found, { phase: 'error', requestId: 'p1', code: 'auth-failed', message: 'org.bluez.Error.AuthenticationFailed' });
    expect(err.device.name).toBe('R1');
    const done = mergePairingProgress(err, { phase: 'done', requestId: 'p1', paired: [], reason: 'pair-failed' });
    expect(done.code).toBe('auth-failed');
    expect(done.device.name).toBe('R1');
  });
  it('mergePairingProgress ignores another request, except a new window once this one is done', () => {
    const p1 = { phase: 'scanning', requestId: 'p1', mode: 'address', optimistic: true };
    // A late line from an older window (p0) never overwrites the one the screen waits on.
    expect(mergePairingProgress(p1, { phase: 'error', requestId: 'p0', code: 'auth-failed' })).toBe(p1);
    expect(mergePairingProgress(p1, { phase: 'done', requestId: 'p0', paired: [], reason: 'pair-failed' })).toBe(p1);
    expect(mergePairingProgress(p1, { phase: 'scanning', requestId: 'p0' })).toBe(p1);
    // Once p1 is done, another window's start is adopted (the backend route's repair).
    const done = { phase: 'done', requestId: 'p1', paired: [], reason: 'busy' };
    expect(mergePairingProgress(done, { phase: 'scanning', requestId: 'r9', mode: 'repair' })).toMatchObject({ phase: 'scanning', requestId: 'r9', mode: 'repair' });
    expect(mergePairingProgress(done, { phase: 'found', requestId: 'r9' })).toBe(done);
    expect(mergePairingProgress(null, { phase: 'scanning', requestId: 'r9' }).requestId).toBe('r9');
  });
  it('mergePairingProgress carries an error code into done only, not into later live phases', () => {
    let s = { phase: 'scanning', requestId: 'p1', mode: 'address' };
    s = mergePairingProgress(s, { phase: 'retry', requestId: 'p1', code: 'auth-failed', message: 'x' });
    expect(s.code).toBe('auth-failed');
    s = mergePairingProgress(s, { phase: 'pairing', requestId: 'p1' });
    expect(s.code).toBeUndefined();
    s = mergePairingProgress(s, { phase: 'passkey', requestId: 'p1', passkey: '123456' });
    expect(s.code).toBeUndefined();
    expect(mergePairingProgress(s, { phase: 'done', requestId: 'p1', paired: [], reason: 'pair-failed' }).code).toBe('auth-failed');
    expect(mergePairingProgress(s, { phase: 'paired', requestId: 'p1' }).code).toBeUndefined();
  });
  it('mergePairingProgress flags an old satellite: an address request answered by a scanning in another mode', () => {
    const cur = { phase: 'scanning', requestId: 'p1', mode: 'address', optimistic: true };
    expect(mergePairingProgress(cur, { phase: 'scanning', requestId: 'p1', mode: 'repair' }).satelliteOutdated).toBe(true);
    expect(mergePairingProgress(cur, { phase: 'scanning', requestId: 'p1' }).satelliteOutdated).toBe(true);
    const ok = mergePairingProgress(cur, { phase: 'scanning', requestId: 'p1', mode: 'address' });
    expect(ok.satelliteOutdated).toBeUndefined();
    const held = mergePairingProgress({ ...cur, satelliteOutdated: true }, { phase: 'done', requestId: 'p1', paired: [] });
    expect(held.satelliteOutdated).toBe(true);
    // A repair request answered without mode is fine.
    const rep = { phase: 'scanning', requestId: 'p2', mode: 'repair', optimistic: true };
    expect(mergePairingProgress(rep, { phase: 'scanning', requestId: 'p2' }).satelliteOutdated).toBeUndefined();
  });
  it('mergeScanProgress: scanning sets the end time, nearby replaces the list, done clears it', () => {
    const start = { phase: 'starting', requestId: 's1', optimistic: true, devices: [] };
    const scanning = mergeScanProgress(start, { requestId: 's1', phase: 'scanning', durationMs: 60000 }, 1000);
    expect(scanning).toMatchObject({ phase: 'scanning', endsAt: 61000, optimistic: false, devices: [] });
    const nearby = mergeScanProgress(scanning, { requestId: 's1', phase: 'nearby', devices: [{ address: 'A' }] }, 2000);
    expect(nearby.devices).toEqual([{ address: 'A' }]);
    expect(nearby.endsAt).toBe(61000);
    const done = mergeScanProgress(nearby, { requestId: 's1', phase: 'done', reason: 'timeout' }, 3000);
    expect(done).toMatchObject({ phase: 'done', reason: 'timeout', devices: [] });
  });
  it('mergeScanProgress ignores an old search, a helper warn, and anything but done while stopping', () => {
    const cur = { phase: 'scanning', requestId: 's2', devices: [], endsAt: 5 };
    expect(mergeScanProgress(cur, { requestId: 's1', phase: 'done', reason: 'stopped' }, 0)).toBe(cur);
    expect(mergeScanProgress(cur, { requestId: 's2', phase: 'warn', message: 'StartDiscovery: x' }, 0)).toBe(cur);
    const stopping = { ...cur, phase: 'stopping' };
    expect(mergeScanProgress(stopping, { requestId: 's2', phase: 'nearby', devices: [{ address: 'A' }] }, 0)).toBe(stopping);
    expect(mergeScanProgress(stopping, { requestId: 's2', phase: 'done', reason: 'stopped' }, 0).phase).toBe('done');
  });
  it('scanSilenceReason: alive satellite = needs an update; silent = no answer', () => {
    expect(scanSilenceReason({ lastHealthAt: 10000, now: 20000 })).toBe('satellite-outdated');
    expect(scanSilenceReason({ lastHealthAt: 0, now: 20000 })).toBe('no-response');
    expect(scanSilenceReason({ lastHealthAt: 1000, now: 20000 })).toBe('no-response');
  });
  it('builds a bt.remove for an address', () => {
    expect(buildRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' }))
      .toEqual({ topic: 'bt.remove', requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' });
  });
});
