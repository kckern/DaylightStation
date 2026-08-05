import { describe, expect, it } from 'vitest';
import {
  decodeSchoolContinuationCode,
  encodeSchoolContinuationCode,
  normalizeSchoolContinuationModuleCode,
} from './continuationCode.mjs';

describe('School continuation codes', () => {
  it('reversibly packs a stable learner slot and authored module code into six digits', () => {
    expect(encodeSchoolContinuationCode({ learnerSlot: 2, moduleCode: '098765' })).toBe('123456');
    expect(decodeSchoolContinuationCode('123456')).toEqual({ learnerSlot: 2, moduleCode: '098765' });
  });

  it('is a permutation across every supported learner/module combination', () => {
    const seen = new Set();
    for (const learnerSlot of [0, 1, 2, 3]) {
      for (const moduleCode of ['000000', '000001', '098765', '249999']) {
        const code = encodeSchoolContinuationCode({ learnerSlot, moduleCode });
        expect(seen.has(code)).toBe(false);
        seen.add(code);
        expect(decodeSchoolContinuationCode(code)).toEqual({ learnerSlot, moduleCode });
      }
    }
  });

  it('rejects source codes outside the allocated four-learner space', () => {
    expect(() => normalizeSchoolContinuationModuleCode('250000')).toThrow(/249999/);
    expect(() => normalizeSchoolContinuationModuleCode('98765')).toThrow(/six decimal/);
  });
});
