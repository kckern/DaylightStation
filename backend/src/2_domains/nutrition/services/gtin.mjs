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

/** @returns {{ok:true, code:string, collapsed:boolean} | {ok:false, reason:string, code?:string}} */
export function parseGtin(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'empty' };
  const half = digits.length / 2;
  if (Number.isInteger(half) && GTIN_LENGTHS.has(half) && digits.slice(0, half) === digits.slice(half)) {
    const single = parseGtin(digits.slice(0, half));
    return single.ok ? { ...single, collapsed: true } : single;
  }
  if (!GTIN_LENGTHS.has(digits.length)) return { ok: false, reason: 'length', code: digits };
  if (digits.length === 13 && ISBN13.test(digits)) return { ok: false, reason: 'isbn', code: digits };
  if (!gtinCheckDigitValid(digits)) return { ok: false, reason: 'check-digit', code: digits };
  return { ok: true, code: digits, collapsed: false };
}
