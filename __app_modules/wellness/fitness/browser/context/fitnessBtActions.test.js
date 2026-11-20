import { describe, it, expect } from 'vitest';
import { buildPairRequest, buildRemoveRequest, mergePairingProgress, PAIR_WINDOW_MS } from "./fitnessBtActions.js";

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
  it('buildPairRequest carries mode, default repair, anything else is repair', () => {
    expect(buildPairRequest({ requestId: 'r' }).mode).toBe('repair');
    expect(buildPairRequest({ requestId: 'r', mode: 'add' }).mode).toBe('add');
    expect(buildPairRequest({ requestId: 'r', mode: 'bogus' }).mode).toBe('repair');
  });
  it('mergePairingProgress keeps the window mode on later messages of the same request', () => {
    const cur = { phase: 'scanning', requestId: 'p1', mode: 'add', optimistic: true };
    expect(mergePairingProgress(cur, { phase: 'found', requestId: 'p1', device: { name: 'R1' } }))
      .toEqual({ phase: 'found', requestId: 'p1', device: { name: 'R1' }, mode: 'add' });
    // A message that carries its own mode wins.
    expect(mergePairingProgress(cur, { phase: 'scanning', requestId: 'p1', mode: 'repair' }).mode).toBe('repair');
    // Another request never inherits it.
    expect(mergePairingProgress(cur, { phase: 'found', requestId: 'p2' }).mode).toBeUndefined();
    expect(mergePairingProgress(null, { phase: 'found', requestId: 'p1' }).mode).toBeUndefined();
    // Neither side has a requestId: nothing ties them together.
    expect(mergePairingProgress({ phase: 'scanning', mode: 'add' }, { phase: 'found' }).mode).toBeUndefined();
  });
  it('builds a bt.remove for an address', () => {
    expect(buildRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' }))
      .toEqual({ topic: 'bt.remove', requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' });
  });
});
