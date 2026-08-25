import { describe, expect, it } from 'vitest';
import { issueWorksheet } from './questionBankV2.mjs';

const bank = { id: 'cfm/test', items: Array.from({ length: 12 }, (_, index) => ({
  id: `q${index}`, type: 'multiple_choice', prompt: `Question ${index}?`, answer: 'Yes', decoys: ['No', 'Maybe', 'Later'],
})) };

describe('short worksheet profiles', () => {
  it('issues the requested three-question lower and five-question upper variants', () => {
    expect(issueWorksheet({ bank, learnerId: 'milo', enrollmentId: 'e1', lessonId: 'd1', profile: 'lower-3', seed: 'a' }).items).toHaveLength(3);
    expect(issueWorksheet({ bank, learnerId: 'felix', enrollmentId: 'e2', lessonId: 'd1', profile: 'upper-5', seed: 'b' }).items).toHaveLength(5);
  });
});
