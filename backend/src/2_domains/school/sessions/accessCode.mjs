/**
 * A 6-digit access code is a human-typable alias for a printed `subject_next`
 * token. A child types it into the school-room panel; the panel resolves it to
 * the same token a QR scan would have carried.
 *
 * It is NOT authentication (design D1): anyone who can read the code can ask
 * the panel to open that work. The lock keeps a child on task, not out of a
 * vault, so there is no throttle and no lockout anywhere in this path.
 *
 * Deliberately NOT `../continuationCode.mjs`. That module is a reversible
 * affine encoding of `learnerSlot x moduleCode` — permanent and fully
 * enumerable by design, and typed into a CALCULATOR. These are random,
 * study-day scoped, and typed into a PANEL.
 *
 * Randomness is injected, never read: this module has no clock and no
 * `Math.random`, exactly as `mintToken({ rng })` does not.
 */
export const SCHOOL_ACCESS_CODE_DIGITS = 6;
export const SCHOOL_ACCESS_CODE_SPACE = 1_000_000;

/** Bounded so an exhausted space fails loudly instead of spinning. */
const MAX_MINT_ATTEMPTS = 50;
const CODE = /^\d{6}$/;

/**
 * Validate a code typed at the panel (or read back off a record).
 *
 * Strict on purpose: `'42'`, `42` and `' 000042 '` are all rejected rather than
 * coerced, because a code is a lookup key and a silent coercion here would make
 * two different keystrokes resolve to the same work. Zero-padding is part of the
 * value, not decoration — `'000042'` is the code, `'42'` is a typo.
 *
 * @param {*} value
 * @returns {string} the same six-digit string
 */
export function normalizeAccessCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new Error('School access code must be exactly six decimal digits');
  }
  return value;
}

/**
 * Draw one unused access code.
 *
 * @param {object}   args
 * @param {Function} args.random  () => number in [0,1) (injected — composition
 *                                supplies the real draw, tests a scripted one)
 * @param {Function} [args.taken] (code) => boolean — collision predicate over
 *                                whatever scope the caller considers live
 * @returns {string} six digits, zero-padded
 */
export function mintAccessCode({ random, taken = () => false } = {}) {
  if (typeof random !== 'function') throw new Error('mintAccessCode: random function is required');
  for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt += 1) {
    // Clamp rather than trust — the same posture mintToken takes with rng. An
    // rng returning exactly 1 would otherwise land on 1000000, a SEVEN-digit
    // code that `normalizeAccessCode` would then reject at the far end.
    const draw = Math.min(Math.max(Number(random()) || 0, 0), 0.9999999999);
    const code = String(Math.floor(draw * SCHOOL_ACCESS_CODE_SPACE))
      .padStart(SCHOOL_ACCESS_CODE_DIGITS, '0');
    if (!taken(code)) return code;
  }
  throw new Error('mintAccessCode: could not mint an unused code');
}
