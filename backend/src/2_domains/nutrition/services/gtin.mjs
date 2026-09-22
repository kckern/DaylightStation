/**
 * Barcode shape for FOOD lookups. A GTIN is 8, 12, 13 or 14 digits ending in a
 * mod-10 check digit. The shared kitchen reader also sees books, and a held
 * trigger can emit the same code twice without a terminator; both must be
 * caught before a product database answers them with a nonsense food.
 */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const ISBN13 = /^97[89]/;

export function gtinCheckDigitValid(digits) {
  if (!/^\d+$/.test(digits) || !GTIN_LENGTHS.has(digits.length)) return false;
  let sum = 0;
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(digits[i]) * weight;
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/**
 * UPC-E (8 digits: number system 0/1, six data digits, check) is a
 * zero-suppressed UPC-A. The last data digit says where the zeros went.
 * @returns {string|null} the 12-digit UPC-A, or null when not UPC-E shaped
 */
export function expandUpcE(digits) {
  if (!/^[01]\d{7}$/.test(digits)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = digits;
  let body;
  if (d6 <= '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/**
 * @returns {{ok:true, code:string, collapsed:boolean, expanded?:true, padded?:true}
 *         | {ok:false, reason:string, code?:string}}
 */
export function parseGtin(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'empty' };
  const half = digits.length / 2;
  if (Number.isInteger(half) && GTIN_LENGTHS.has(half) && digits.slice(0, half) === digits.slice(half)) {
    const single = parseGtin(digits.slice(0, half));
    return single.ok ? { ...single, collapsed: true } : single;
  }
  // Manual entry of a UPC-A often drops the leading zero. Pad only when the
  // padded code then proves itself by its check digit.
  if (digits.length === 11 && gtinCheckDigitValid(`0${digits}`)) {
    return { ok: true, code: `0${digits}`, collapsed: false, padded: true };
  }
  if (!GTIN_LENGTHS.has(digits.length)) return { ok: false, reason: 'length', code: digits };
  if (digits.length === 13 && ISBN13.test(digits)) return { ok: false, reason: 'isbn', code: digits };
  if (!gtinCheckDigitValid(digits)) {
    const upcA = digits.length === 8 ? expandUpcE(digits) : null;
    if (upcA && gtinCheckDigitValid(upcA)) return { ok: true, code: upcA, collapsed: false, expanded: true };
    return { ok: false, reason: 'check-digit', code: digits };
  }
  return { ok: true, code: digits, collapsed: false };
}
