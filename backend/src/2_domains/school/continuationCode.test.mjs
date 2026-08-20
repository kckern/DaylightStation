import { describe, expect, it } from 'vitest';
import {
  decodeSchoolContinuationCode,
  encodeSchoolContinuationCode,
  normalizeSchoolContinuationModuleCode,
} from './continuationCode.mjs';

/** Capture rather than match a message: the code is the contract, the prose is not. */
const thrownBy = (fn) => {
  try { fn(); } catch (error) { return error; }
  throw new Error('expected the call to throw, but it returned');
};

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
    const outOfRange = thrownBy(() => normalizeSchoolContinuationModuleCode('250000'));
    expect(outOfRange.name).toBe('ValidationError');
    expect(outOfRange.code).toBe('SCHOOL_CONTINUATION_MODULE_CODE_OUT_OF_RANGE');
    // `moduleValidation` catches this and pushes `error.message` into its own
    // error list, where a test asserts on the range — so the text is contract
    // here, not decoration.
    expect(outOfRange.message).toContain('249999');

    const malformed = thrownBy(() => normalizeSchoolContinuationModuleCode('98765'));
    expect(malformed.name).toBe('ValidationError');
    expect(malformed.code).toBe('INVALID_SCHOOL_CONTINUATION_CODE');
    expect(malformed.message).toContain('six decimal digits');
  });

  it.each([
    ['too short', '98765'],
    ['too long', '1234567'],
    ['letters', 'abc123'],
    ['a number, not a string', 123456],
    ['null', null],
  ])('types the decode-side format failure identically (%s)', (_label, bad) => {
    const error = thrownBy(() => decodeSchoolContinuationCode(bad));
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('INVALID_SCHOOL_CONTINUATION_CODE');
  });

  it.each([
    ['below the space', -1],
    ['above the space', 4],
    ['fractional', 1.5],
    ['a numeric string', '2'],
    ['null', null],
  ])('types an unusable learner slot (%s)', (_label, learnerSlot) => {
    const error = thrownBy(() => encodeSchoolContinuationCode({ learnerSlot, moduleCode: '000042' }));
    expect(error.name).toBe('ValidationError');
    expect(error.code).toBe('SCHOOL_CONTINUATION_LEARNER_SLOT_INVALID');
  });
});
