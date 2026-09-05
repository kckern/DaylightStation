/**
 * isbn — the number under the barcode, judged on the panel before any
 * network call (reading-shelf design §5, step 1).
 *
 * A PORT, NOT AN IMPORT. The rules are `backend/src/2_domains/books/
 * BookIdentifier.mjs`'s ISBN half, copied here because the frontend cannot
 * reach the backend tree and the shape of a code must be knowable offline
 * (PRD B2): a malformed number never costs a round trip. Keep the two in step;
 * the test mirrors the backend's fixtures so a drift shows up as a red test,
 * not as two different sentences for one number.
 *
 * THE ONE THING THIS ADDS IS A LENGTH GATE. The backend judges a finished
 * string; this runs on every keystroke. A child three digits into a thirteen-
 * digit number is not holding the library's sticker, so under THIRTEEN
 * characters there is NO verdict yet (`typing`) — ten, eleven and twelve
 * included. Ten is the trap: the first ten digits of a thirteen-digit number
 * pass the ISBN-10 checksum one time in eleven, and `Look it up` would light
 * on the wrong book; the other ten times the child reads "one digit is off"
 * while still typing. So ten is judged as an ISBN-10 only when the entry ends
 * in `X` (a check character only an ISBN-10 has) or when the caller says the
 * child STOPPED there (`submit: true`). Thirteen is judged on the keystroke;
 * more than thirteen cannot be an ISBN and is named as such.
 *
 * Pure. Never throws.
 */

/** 978/979. A 13-digit code behind anything else is a product, not a book. */
const BOOKLAND = ['978', '979'];

/** What the child reads for each way a number can be wrong (design §5). */
export const COPY = Object.freeze({
  'isbn13-checksum': 'Check that number — one digit is off',
  'isbn10-checksum': 'Check that number — one digit is off',
  'not-a-book-prefix': "That's the library's sticker. Flip the book over.",
  'not-an-identifier': "That's the library's sticker. Flip the book over.",
  'not-found': "We couldn't find a title or cover. You can still log this ISBN.",
  unavailable: "Can't look books up right now — try again in a minute",
});

/** ISBN-13 check digit: alternating 1/3 weights over the first twelve digits. */
function isbn13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** ISBN-10 is valid when the 10..1 weighted sum is divisible by 11; X counts as 10. */
function isValidIsbn10(value) {
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = value[i];
    const digit = char === 'X' ? 10 : Number(char);
    if (!Number.isInteger(digit)) return false;
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

/** The 978-prefixed ISBN-13 for a valid ISBN-10. */
function isbn10To13(isbn10) {
  const body = `978${isbn10.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

/**
 * Judge what has been typed so far.
 *
 * @param {unknown} input - the pad's current value; spaces, hyphens and the
 *   CR/LF a scanner appends are stripped before anything is judged
 * @param {{submit?: boolean}} [options] - `submit: true` means the child
 *   stopped here and tapped `Look it up`: a ten-digit entry is then judged as
 *   an ISBN-10 instead of being read as the first ten of thirteen
 * @returns {{state: 'typing'}
 *   | {state: 'valid', isbn13: string}
 *   | {state: 'invalid', reason: 'isbn13-checksum'|'isbn10-checksum'|'not-a-book-prefix'|'not-an-identifier'}}
 */
export function checkIsbn(input, { submit = false } = {}) {
  if (typeof input !== 'string') return { state: 'typing' };
  const compact = input.replace(/[\s-]/g, '').toUpperCase();

  // The length gate. Under thirteen there is nothing to judge yet — except
  // a ten the child stopped at, or one ending in an ISBN-10's X.
  if (compact.length < 10) return { state: 'typing' };
  if (compact.length < 13 && !(compact.length === 10 && (submit || compact.endsWith('X')))) {
    return { state: 'typing' };
  }

  if (compact.length === 13) {
    if (!/^\d{13}$/.test(compact)) return { state: 'invalid', reason: 'not-an-identifier' };
    if (!BOOKLAND.some((prefix) => compact.startsWith(prefix))) {
      return { state: 'invalid', reason: 'not-a-book-prefix' };
    }
    if (Number(compact[12]) !== isbn13CheckDigit(compact.slice(0, 12))) {
      return { state: 'invalid', reason: 'isbn13-checksum' };
    }
    return { state: 'valid', isbn13: compact };
  }

  if (compact.length === 10) {
    if (!/^\d{9}[\dX]$/.test(compact)) return { state: 'invalid', reason: 'not-an-identifier' };
    if (!isValidIsbn10(compact)) return { state: 'invalid', reason: 'isbn10-checksum' };
    return { state: 'valid', isbn13: isbn10To13(compact) };
  }

  // More than 13: no ISBN is that long, whatever the digits.
  return { state: 'invalid', reason: 'not-an-identifier' };
}

/**
 * The sentence for a verdict, or null when there is nothing to say — still
 * typing, or a valid number the `Look it up` button answers instead.
 */
export function hintFor(check) {
  if (!check || check.state !== 'invalid') return null;
  return COPY[check.reason] ?? null;
}

export default checkIsbn;
