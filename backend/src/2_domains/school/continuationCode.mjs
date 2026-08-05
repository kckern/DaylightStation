/**
 * A short continuation code routes a learner from another School surface to
 * an installed learning module.  It is intentionally not authentication:
 * anyone who can see a code can ask a calculator to open that work.
 *
 * Four stable learner slots and 250,000 authored module codes occupy the
 * entire six-decimal-digit space.  The affine permutation makes the visible
 * number evenly distributed while remaining exactly reversible offline.
 */
export const SCHOOL_CONTINUATION_CODE_DIGITS = 6;
export const SCHOOL_CONTINUATION_CODE_SPACE = 1_000_000;
export const SCHOOL_CONTINUATION_LEARNER_SLOTS = 4;
export const SCHOOL_CONTINUATION_MODULE_SPACE = 250_000;

const MULTIPLIER = 73;
const MULTIPLIER_INVERSE = 630_137;
const OFFSET = 413_611;
const CODE = /^\d{6}$/;

export function normalizeSchoolContinuationModuleCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new Error('School continuationCode must be exactly six decimal digits');
  }
  const numeric = Number(value);
  if (numeric >= SCHOOL_CONTINUATION_MODULE_SPACE) {
    throw new Error('School continuationCode must be between 000000 and 249999');
  }
  return value;
}

export function encodeSchoolContinuationCode({ learnerSlot, moduleCode } = {}) {
  const slot = normalizeLearnerSlot(learnerSlot);
  const code = Number(normalizeSchoolContinuationModuleCode(moduleCode));
  const payload = (slot * SCHOOL_CONTINUATION_MODULE_SPACE) + code;
  return String(((MULTIPLIER * payload) + OFFSET) % SCHOOL_CONTINUATION_CODE_SPACE)
    .padStart(SCHOOL_CONTINUATION_CODE_DIGITS, '0');
}

export function decodeSchoolContinuationCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new Error('School continuation access code must be exactly six decimal digits');
  }
  const encoded = Number(value);
  const payload = mod(MULTIPLIER_INVERSE * (encoded - OFFSET), SCHOOL_CONTINUATION_CODE_SPACE);
  return Object.freeze({
    learnerSlot: Math.floor(payload / SCHOOL_CONTINUATION_MODULE_SPACE),
    moduleCode: String(payload % SCHOOL_CONTINUATION_MODULE_SPACE).padStart(SCHOOL_CONTINUATION_CODE_DIGITS, '0'),
  });
}

function normalizeLearnerSlot(value) {
  if (!Number.isInteger(value) || value < 0 || value >= SCHOOL_CONTINUATION_LEARNER_SLOTS) {
    throw new Error(`School continuation learnerSlot must be 0..${SCHOOL_CONTINUATION_LEARNER_SLOTS - 1}`);
  }
  return value;
}

function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
