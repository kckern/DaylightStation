import { describe, expect, it } from 'vitest';
import { HmacSchoolReelGrantIssuer } from './HmacSchoolReelGrantIssuer.mjs';

describe('HmacSchoolReelGrantIssuer', () => {
  it('binds a short-lived launch to its learner, unit, reel, and revision', () => {
    let now = 1_000;
    const issuer = new HmacSchoolReelGrantIssuer({ key: 'r'.repeat(32), clock: () => now });
    const token = issuer.issue({ learnerId: 'learner3', unitId: 'language-reel-10', reelId: '10', revision: 'rev-a' });
    expect(issuer.verify(token, { learnerId: 'learner3', unitId: 'language-reel-10', reelId: '10' }).ok).toBe(true);
    expect(issuer.verify(token, { learnerId: 'learner3', unitId: 'language-reel-11', reelId: '10' }).reason).toBe('unitId');
    now += 2 * 60 * 60 * 1000;
    expect(issuer.verify(token).reason).toBe('expired');
  });
});
