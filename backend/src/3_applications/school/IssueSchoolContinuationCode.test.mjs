import { describe, expect, it } from 'vitest';
import { IssueSchoolContinuationCode } from './IssueSchoolContinuationCode.mjs';

describe('IssueSchoolContinuationCode', () => {
  const slots = { learner1: 0, learner2: 1, learner3: 2, learner4: 3 };
  const learners = { hasLearner: async (id) => Object.hasOwn(slots, id) };

  it('issues the stable published code for a learner and authored module code', async () => {
    const issuer = new IssueSchoolContinuationCode({ learners, learnerSlots: slots });
    await expect(issuer.execute({ learnerId: 'learner3', moduleCode: '098765' })).resolves.toMatchObject({
      learnerId: 'learner3', learnerSlot: 2, moduleCode: '098765', code: '123456',
    });
  });

  it('rejects unknown learners and incomplete household slot maps', async () => {
    const issuer = new IssueSchoolContinuationCode({ learners, learnerSlots: slots });
    await expect(issuer.execute({ learnerId: 'parent', moduleCode: '098765' })).rejects.toThrow(/unknown learner/);
    expect(() => new IssueSchoolContinuationCode({ learners, learnerSlots: { learner3: 2 } })).toThrow(/0..3/);
  });
});
