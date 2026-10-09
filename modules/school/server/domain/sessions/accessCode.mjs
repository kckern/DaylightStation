/**
 * A 6-digit access code is a human-typable alias for a printed `subject_next`
 * token. A child types it into the school-room panel; the panel resolves it to
 * the same token a QR scan would have carried.
 *
 * It is NOT authentication (design D1): anyone who can read the code can ask
 * the panel to open that work. The lock keeps a child on task, not out of a
 * vault.
 *
 * That was once written here as "so there is no throttle and no lockout
 * anywhere in this path", and as of 2026-09-06 it is no longer true. It stopped
 * being true the day a code opened a free-form SHELF rather than one lesson: a
 * single code was typed thirteen times in five hours, and nothing spent it,
 * slowed it, or noticed. Two limits now exist, and neither makes this
 * authentication:
 *
 *   - a code is spent after `DEFAULT_ACCESS_CODE_MAX_USES` opens (below);
 *   - repeated REJECTED codes are throttled at the panel.
 *
 * Both bound how much one leaked code is worth. Neither asks who is holding
 * it — that question has no answer at a keypad, and pretending otherwise is
 * what the original note was right to warn against.
 *
 * Deliberately NOT `../continuationCode.mjs`. That module is a reversible
 * affine encoding of `learnerSlot x moduleCode` — permanent and fully
 * enumerable by design, and typed into a CALCULATOR. These are random,
 * study-day scoped, and typed into a PANEL.
 *
 * Randomness is injected, never read: this module has no clock and no
 * `Math.random`, exactly as `mintToken({ rng })` does not.
 */
import { ValidationError, DomainInvariantError } from '#domains/core/errors/index.mjs';

export const SCHOOL_ACCESS_CODE_DIGITS = 6;

/**
 * How many times one printed code may OPEN something before it is spent.
 *
 * Three, because a real lesson trip is one open and a fumble is two — a
 * mis-tap, a card closed by accident, a child who walked away and came back.
 * Three leaves room for that and still stops a code being typed thirteen times
 * in five hours, which is what one was (2026-09-06), by someone who was
 * probably not the child whose paper it was printed on.
 *
 * NOT A LOCK, and the header above still stands: anyone who can read the code
 * can use it, three times. What this removes is the ALL-DAY window — a code
 * that opened work without limit until 4am the next morning.
 *
 * The reading log is deliberately exempt (`BuildAgenda`): a log is not a task,
 * and "I finished another one" is a thing a child may honestly do five times in
 * a day. Frequency was only ever a proxy there; the shelf's own learner chip is
 * what answers "whose log is this?".
 */
export const DEFAULT_ACCESS_CODE_MAX_USES = 3;

/** Derived, never restated: widening DIGITS must widen the space and the pattern together. */
export const SCHOOL_ACCESS_CODE_SPACE = 10 ** SCHOOL_ACCESS_CODE_DIGITS;

/** Bounded so an exhausted space fails loudly instead of spinning. */
const MAX_MINT_ATTEMPTS = 50;

/**
 * Built from DIGITS for the same reason `tokens.mjs` builds TOKEN_PATTERN from
 * BODY_CHARSET/BODY_LENGTH: a hand-written `\d{6}` would keep rejecting every
 * code the minter produced the day the width changed.
 */
const CODE = new RegExp(`^\\d{${SCHOOL_ACCESS_CODE_DIGITS}}$`);

/**
 * Validate a code typed at the panel (or read back off a record).
 *
 * Strict on purpose: `'42'`, `42` and `' 000042 '` are all rejected rather than
 * coerced, because a code is a lookup key. Coercing here would make two
 * different keystrokes resolve to the same work. Zero-padding is part of the
 * value, not decoration — `'000042'` is the code, `'42'` is a typo.
 *
 * Note this is the OPPOSITE policy to `isSchoolToken` in `tokens.mjs`, which
 * trims because a barcode scanner appends whitespace of its own. Nothing
 * scans a code; a child types it, and the panel owns any trimming before it
 * reaches the domain.
 *
 * @param {*} value - candidate code, expected to be a six-digit string
 * @returns {string} the same six-digit string
 * @throws {ValidationError} if it is not exactly six decimal digits
 */
export function normalizeAccessCode(value) {
  if (typeof value !== 'string' || !CODE.test(value)) {
    throw new ValidationError('School access code must be exactly six decimal digits', {
      code: 'INVALID_SCHOOL_ACCESS_CODE',
    });
  }
  return value;
}

/**
 * Draw one unused access code.
 *
 * Both collaborators are required. `taken` has no default on purpose: a default
 * of "nothing is taken" would let a caller who forgets the predicate mint
 * duplicates with no type error and no failing test.
 *
 * @param {object}   args
 * @param {Function} args.rng   () => number in [0,1) (injected — composition
 *                              supplies the real draw, tests a scripted one)
 * @param {Function} args.taken (code) => boolean — collision predicate over
 *                              whatever scope the caller considers live
 * @returns {string} six digits, zero-padded
 * @throws {ValidationError} if rng or taken is missing
 * @throws {DomainInvariantError} if rng misbehaves, or the space is exhausted
 */
export function mintAccessCode({ rng, taken } = {}) {
  if (typeof rng !== 'function') {
    throw new ValidationError('mintAccessCode: rng function is required', {
      code: 'INVALID_SCHOOL_ACCESS_CODE_MINT', details: { missing: 'rng' },
    });
  }
  if (typeof taken !== 'function') {
    throw new ValidationError('mintAccessCode: taken predicate is required', {
      code: 'INVALID_SCHOOL_ACCESS_CODE_MINT', details: { missing: 'taken' },
    });
  }

  for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt += 1) {
    const raw = rng();
    // Refuse rather than fall back to 0. `mintToken` shares the `|| 0` idiom and
    // degrades visibly there — 16 identical characters looks broken on sight.
    // Here a fallback mints `000000`, which looks like a perfectly legal code,
    // so a miswired rng would print the SAME code on every agenda for every
    // child and nothing downstream would notice.
    //
    // What matters is that this runs BEFORE any coercion. Guarding
    // `Number(rng())` instead would not work: `Number(null)` is 0, a finite
    // value that mints `000000`. `Number.isFinite` takes the raw draw directly
    // because, unlike the global `isFinite`, it does not coerce — it is already
    // false for null, `'0.5'` and `{}`. The `typeof` clause is belt-and-braces
    // on top, kept so a future edit cannot reintroduce coercion unnoticed.
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new DomainInvariantError('mintAccessCode: rng returned a non-numeric draw', {
        code: 'SCHOOL_ACCESS_CODE_RNG_INVALID', details: { draw: raw },
      });
    }
    // Clamp in-range drift only: an rng returning exactly 1 would otherwise land
    // on 1000000, a SEVEN-digit code `normalizeAccessCode` rejects at the far end.
    const draw = Math.min(Math.max(raw, 0), 0.9999999999);
    const code = String(Math.floor(draw * SCHOOL_ACCESS_CODE_SPACE))
      .padStart(SCHOOL_ACCESS_CODE_DIGITS, '0');
    if (!taken(code)) return code;
  }

  throw new DomainInvariantError(
    `mintAccessCode: could not mint an unused code after ${MAX_MINT_ATTEMPTS} attempts`,
    { code: 'SCHOOL_ACCESS_CODE_SPACE_EXHAUSTED', details: { attempts: MAX_MINT_ATTEMPTS } },
  );
}
