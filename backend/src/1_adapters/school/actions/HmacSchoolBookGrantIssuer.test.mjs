import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HmacSchoolBookGrantIssuer } from './HmacSchoolBookGrantIssuer.mjs';

const T0 = Date.parse('2026-09-02T20:00:00Z');
// The issuer refuses keys under 32 bytes, as the cube issuer does.
const KEY = 'test-secret-test-secret-test-secret-test-secret';
const issuer = (now = T0) => new HmacSchoolBookGrantIssuer({ key: KEY, clock: () => now, ttlMs: 3_600_000 });

describe('HmacSchoolBookGrantIssuer', () => {
  it('issues a grant that verifies for the same learner', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    const result = issuer().verify(grant, { learnerId: 'kid' });
    expect(result.ok).toBe(true);
    expect(result.payload.learnerId).toBe('kid');
    expect(result.payload.purpose).toBe('book-shelf');
  });
  it('refuses a grant for a different learner', () => {
    expect(issuer().verify(issuer().issue({ learnerId: 'kid' }), { learnerId: 'sibling' }).ok).toBe(false);
  });
  it('refuses a tampered grant', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    expect(issuer().verify(`${grant.slice(0, -2)}xx`, { learnerId: 'kid' }).ok).toBe(false);
  });
  it('refuses an expired grant', () => {
    const grant = issuer().issue({ learnerId: 'kid' });
    expect(issuer(T0 + 86_400_000).verify(grant, { learnerId: 'kid' }).ok).toBe(false);
  });
  it('refuses a correctly signed payload that carries no exp — missing is not never-expiring (review n3)', () => {
    // The issuer's own derivation (key context + HMAC over the body), so the
    // signature is REAL and only the payload is short an exp. If the context
    // string ever changes, this test tampers instead and still refuses — but
    // then for the wrong reason, so keep the two in step.
    const signingKey = createHmac('sha256', Buffer.from(KEY, 'utf8')).update('school.book-shelf.launch-grant/v1').digest();
    const mint = (payload) => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${body}.${createHmac('sha256', signingKey).update(body).digest('base64url')}`;
    };
    const noExp = mint({ purpose: 'book-shelf', learnerId: 'kid', jti: 'x' });
    expect(issuer().verify(noExp, { learnerId: 'kid' })).toEqual({ ok: false, reason: 'expired' });
    for (const exp of [null, 'soon', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(issuer().verify(mint({ purpose: 'book-shelf', learnerId: 'kid', jti: 'x', exp }), { learnerId: 'kid' }).ok).toBe(false);
    }
    // The control: the same mint with a real exp verifies, so the signature path above is the issuer's.
    expect(issuer().verify(mint({ purpose: 'book-shelf', learnerId: 'kid', jti: 'x', exp: T0 + 1000 }), { learnerId: 'kid' }).ok).toBe(true);
  });

  it('refuses garbage without throwing', () => {
    expect(issuer().verify(undefined, { learnerId: 'kid' }).ok).toBe(false);
    expect(issuer().verify('not.a.grant', { learnerId: 'kid' }).ok).toBe(false);
  });
  it('refuses a grant signed with a different key', () => {
    const other = new HmacSchoolBookGrantIssuer({ key: 'other-key-other-key-other-key-other-key', clock: () => T0, ttlMs: 3_600_000 });
    expect(issuer().verify(other.issue({ learnerId: 'kid' }), { learnerId: 'kid' }).ok).toBe(false);
  });
});
