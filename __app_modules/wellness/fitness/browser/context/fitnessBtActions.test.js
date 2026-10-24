import { describe, it, expect } from 'vitest';
import { buildPairRequest, buildRemoveRequest, PAIR_WINDOW_MS } from "./fitnessBtActions.js";

describe('fitnessBtActions', () => {
  it('builds a bt.pair.request with requestId + duration + targets', () => {
    const targets = [{ id: '8bitdo_sfc30', name: '8bitdo', macPrefix: 'E4:17:D8', pin: '0000' }];
    expect(buildPairRequest({ requestId: 'p1', durationMs: 30000, targets }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p1', durationMs: 30000, targets });
  });
  it('defaults durationMs to the pairing window and targets to []', () => {
    expect(buildPairRequest({ requestId: 'p2' }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p2', durationMs: PAIR_WINDOW_MS, targets: [] });
  });
  it('builds a bt.remove for an address', () => {
    expect(buildRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' }))
      .toEqual({ topic: 'bt.remove', requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' });
  });
});
