import { describe, it, expect } from 'vitest';
import { buildPairRequest, buildRemoveRequest } from './fitnessBtActions.js';

describe('fitnessBtActions', () => {
  it('builds a bt.pair.request with requestId + duration', () => {
    expect(buildPairRequest({ requestId: 'p1', durationMs: 30000 }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p1', durationMs: 30000 });
  });
  it('defaults durationMs to 30000', () => {
    expect(buildPairRequest({ requestId: 'p2' }))
      .toEqual({ topic: 'bt.pair.request', requestId: 'p2', durationMs: 30000 });
  });
  it('builds a bt.remove for an address', () => {
    expect(buildRemoveRequest({ requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' }))
      .toEqual({ topic: 'bt.remove', requestId: 'r1', address: 'AA:BB:CC:DD:EE:FF' });
  });
});
