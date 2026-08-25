import { describe, expect, it } from 'vitest';
import { HmacSchoolCubeGrantIssuer } from './HmacSchoolCubeGrantIssuer.mjs';

describe('HmacSchoolCubeGrantIssuer', () => {
  it('binds the token to its learner, course, and revision', () => {
    let now = 1_000;
    const issuer = new HmacSchoolCubeGrantIssuer({ key: 'c'.repeat(32), clock: () => now });
    const token = issuer.issue({ learnerId: 'milo', unitId: 'cube-1', courseId: 'beginner-v1', revision: 1 });
    expect(issuer.verify(token, { learnerId: 'milo', courseId: 'beginner-v1' }).ok).toBe(true);
    expect(issuer.verify(token, { learnerId: 'felix' }).reason).toBe('learnerId');
    expect(issuer.verify(token, { courseId: 'other-course' }).reason).toBe('courseId');
    now += 2 * 60 * 60 * 1000;
    expect(issuer.verify(token).reason).toBe('expired');
  });
});
