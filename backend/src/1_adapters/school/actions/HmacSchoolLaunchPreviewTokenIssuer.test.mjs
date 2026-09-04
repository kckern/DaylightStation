import { describe, expect, it } from 'vitest';
import { HmacSchoolLaunchPreviewTokenIssuer } from './HmacSchoolLaunchPreviewTokenIssuer.mjs';

const KEY = 'a-test-key-that-is-deliberately-longer-than-thirty-two-bytes';

describe('HmacSchoolLaunchPreviewTokenIssuer', () => {
  it('issues a reloadable preview token that expires after five minutes', () => {
    let now = 1_000;
    const issuer = new HmacSchoolLaunchPreviewTokenIssuer({ key: KEY, clock: () => now });
    const token = issuer.issue({ learnerId: 'user_4', subject: 'science', continueToday: true });

    expect(issuer.verify(token)).toMatchObject({
      ok: true,
      payload: { learnerId: 'user_4', subject: 'science', continueToday: true, iat: 1_000, exp: 301_000 },
    });
    expect(issuer.verify(token).ok).toBe(true);
    now = 301_000;
    expect(issuer.verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tampering and scope mismatches', () => {
    const issuer = new HmacSchoolLaunchPreviewTokenIssuer({ key: KEY, clock: () => 1_000 });
    const token = issuer.issue({ learnerId: 'user_4', subject: 'science' });
    expect(issuer.verify(`${token}x`)).toEqual({ ok: false, reason: 'tampered' });
    expect(issuer.verify(token, { learnerId: 'user_5' })).toEqual({ ok: false, reason: 'learnerId' });
  });
});
