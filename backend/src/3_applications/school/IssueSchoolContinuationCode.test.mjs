import { describe, expect, it } from 'vitest';
import { IssueSchoolContinuationCode } from './IssueSchoolContinuationCode.mjs';

describe('IssueSchoolContinuationCode', () => {
  const slots = { soren: 0, alan: 1, milo: 2, felix: 3 };
  const learners = { hasLearner: async (id) => Object.hasOwn(slots, id) };

  it('issues the stable published code for a learner and authored module code', async () => {
    const issuer = new IssueSchoolContinuationCode({ learners, learnerSlots: slots });
    await expect(issuer.execute({ learnerId: 'milo', moduleCode: '098765' })).resolves.toMatchObject({
      learnerId: 'milo', learnerSlot: 2, moduleCode: '098765', code: '123456',
    });
  });

  it('rejects unknown learners and incomplete household slot maps', async () => {
    const issuer = new IssueSchoolContinuationCode({ learners, learnerSlots: slots });
    await expect(issuer.execute({ learnerId: 'parent', moduleCode: '098765' })).rejects.toThrow(/unknown learner/);
    expect(() => new IssueSchoolContinuationCode({ learners, learnerSlots: { milo: 2 } })).toThrow(/0..3/);
  });
});
