import { describe, expect, it } from 'vitest';
import { HmacSchoolStudyGrantIssuer } from './HmacSchoolStudyGrantIssuer.mjs';

const key = 'a'.repeat(32);

describe('HmacSchoolStudyGrantIssuer', () => {
  it('binds a two-hour grant to purpose, learner, and corpus', () => {
    let now = 1_000;
    const issuer = new HmacSchoolStudyGrantIssuer({ key, clock: () => now });
    const token = issuer.issue({ learnerId: 'learner3', corpusId: 'korean' });
    expect(issuer.verify(token, { learnerId: 'learner3', corpusId: 'korean' }).ok).toBe(true);
    expect(issuer.verify(token, { learnerId: 'learner4', corpusId: 'korean' }).reason).toBe('learner');
    expect(issuer.verify(token, { learnerId: 'learner3', corpusId: 'spanish' }).reason).toBe('corpus');
    now += 2 * 60 * 60 * 1000;
    expect(issuer.verify(token, { learnerId: 'learner3', corpusId: 'korean' }).reason).toBe('expired');
  });

  it('rejects missing and tampered grants', () => {
    const issuer = new HmacSchoolStudyGrantIssuer({ key });
    const token = issuer.issue({ learnerId: 'learner3', corpusId: 'korean' });
    expect(issuer.verify(null, { learnerId: 'learner3', corpusId: 'korean' }).reason).toBe('missing');
    expect(issuer.verify(`${token}x`, { learnerId: 'learner3', corpusId: 'korean' }).reason).toBe('tampered');
  });
});
