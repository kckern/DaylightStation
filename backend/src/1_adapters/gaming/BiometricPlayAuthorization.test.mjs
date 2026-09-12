import { describe, it, expect } from 'vitest';
import { BiometricPlayAuthorization } from './BiometricPlayAuthorization.mjs';

const quiet = { info() {}, warn() {} };
const build = (requestUnlock) => new BiometricPlayAuthorization({
  biometricGateway: { requestUnlock }, logger: quiet,
});

describe('BiometricPlayAuthorization', () => {
  it('confirms a recognised finger', async () => {
    const r = await build(async () => ({ matched: true, userId: 'test-learner' })).confirmIdentity({ candidates: ['a'] });
    expect(r).toEqual({ userId: 'test-learner', confirmed: true, reason: null });
  });

  it('passes the enrolled candidates through to the reader', async () => {
    let seen;
    await build(async (_lock, candidates) => { seen = candidates; return { matched: false }; })
      .confirmIdentity({ candidates: ['uuid-1', 'uuid-2'] });
    expect(seen).toEqual(['uuid-1', 'uuid-2']);
  });

  it('distinguishes nobody-came from not-recognised', async () => {
    // A timeout means we could not ask. Reporting it as a refusal would tell a
    // child they were rejected when they simply have not walked over yet.
    const timedOut = await build(async () => ({ matched: false, reason: 'timeout' })).confirmIdentity({});
    expect(timedOut.reason).toBe('no_response');

    const wrongFinger = await build(async () => ({ matched: false })).confirmIdentity({});
    expect(wrongFinger.reason).toBe('not_recognised');
  });

  it('reports a broken reader as unavailable, not as a denial', async () => {
    const r = await build(async () => { throw new Error('reader offline'); }).confirmIdentity({});
    expect(r).toEqual({ userId: null, confirmed: false, reason: 'unavailable' });
  });

  it('never confirms without a user id, even on a match', async () => {
    const r = await build(async () => ({ matched: true })).confirmIdentity({});
    expect(r.confirmed).toBe(false);
  });

  it('requires a gateway rather than silently doing nothing', () => {
    expect(() => new BiometricPlayAuthorization({})).toThrow(/biometric gateway/);
  });
});
