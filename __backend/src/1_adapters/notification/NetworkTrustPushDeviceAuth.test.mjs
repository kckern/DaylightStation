import { describe, it, expect } from 'vitest';
import { NetworkTrustPushDeviceAuth } from './NetworkTrustPushDeviceAuth.mjs';

describe('NetworkTrustPushDeviceAuth (placeholder until device pairing)', () => {
  it('allows every hello and press', () => {
    const a = new NetworkTrustPushDeviceAuth();
    expect(a.allowHello('c1', { type: 'push.hello' })).toBe(true);
    expect(a.allowPress({ actionId: 'A' })).toBe(true);
    expect(a.kind).toBe('network-trust');
  });
});
