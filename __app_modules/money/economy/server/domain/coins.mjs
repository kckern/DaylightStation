/**
 * Coin amounts: which currencies may hold fractions, and how a fraction is
 * kept exact.
 *
 * Silver and gems are whole coins. GOLD is fractional (2026-10-29: the week
 * close converts silver → gold at 10:1, so 56 silver is 5.6 gold, kept).
 *
 * Precision scheme: a gold amount is a whole number of micro-gold
 * (1 gold = 1,000,000 µg) carried as a JS number rounded to 6 decimals.
 * `quantize` snaps any computed gold figure (silver × rate, a sum) to that
 * grid, and `foldBalances` sums gold in integer micro-gold, so 5.6 + 4.7 is
 * exactly 10.3 — never 10.299999999999999. Six places is far finer than any
 * rate a household would set (silver is whole, so silver × 0.1 has one
 * decimal place), and 2^53 µg is ~9 billion gold, so integer sums never lose
 * a unit. Comparisons (`balance >= price`) run on the quantized figure.
 *
 * Display: a screen shows `Math.floor` of a gold figure (5.6 reads 5); the
 * stored figure keeps the fraction, and fractions accumulate across weeks.
 * Pure: no I/O.
 */

export const FRACTIONAL_CURRENCIES = Object.freeze(new Set(['gold']));

/** Decimal places a fractional currency keeps (micro-units). */
export const FRACTION_DIGITS = 6;
export const UNITS_PER_COIN = 10 ** FRACTION_DIGITS;

export const isFractional = (currency) => FRACTIONAL_CURRENCIES.has(currency);

/** `n` in integer micro-units (gold) — what sums are made of. */
export const toUnits = (n) => Math.round(n * UNITS_PER_COIN);
export const fromUnits = (units) => units / UNITS_PER_COIN;

/** `n` on the currency's grid: gold to 6 places, others unchanged. */
export function quantize(currency, n) {
  if (!isFractional(currency) || !Number.isFinite(n)) return n;
  const q = fromUnits(toUnits(n));
  return Object.is(q, -0) ? 0 : q;
}

/**
 * Whether `n` is a valid non-zero ledger delta in `currency`: a whole number
 * for silver and gems; for gold any finite figure that is still non-zero on
 * the 6-place grid (the entry stores it quantized).
 */
export function isCoinDelta(currency, n) {
  if (!Number.isFinite(n) || n === 0) return false;
  if (!isFractional(currency)) return Number.isInteger(n);
  return quantize(currency, n) !== 0;
}

/** Whether `n` is a valid positive amount in `currency`. */
export const isCoinAmount = (currency, n) => isCoinDelta(currency, n) && n > 0;

/**
 * `amount` of one coin at `rate`, in `to`: exact to 6 places for a fractional
 * `to` (56 silver × 0.1 = 5.6 gold), floored to whole coins otherwise (the
 * epsilon absorbs 0.29 × 100 = 28.999…).
 */
export function convertedAmount(amount, rate, to = null) {
  if (isFractional(to)) return Math.max(0, quantize(to, amount * rate));
  return Math.floor(amount * rate + 1e-9);
}

/** Sum `values` in `currency` exactly (integer micro-units for gold). */
export function sumCoins(currency, values) {
  if (!isFractional(currency)) return values.reduce((s, v) => s + (v || 0), 0);
  return fromUnits(values.reduce((s, v) => s + toUnits(v || 0), 0));
}

/**
 * The whole coins a screen shows for `n`, rounded toward zero: 5.6 gold reads
 * 5, −0.4 reads 0 (never −1), never −0. Mirrored by `coinFigure` in
 * `frontend/src/lib/coins/coinFigure.js`.
 */
export const displayCoins = (n) => {
  if (!Number.isFinite(n)) return 0;
  const whole = n < 0 ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return whole === 0 ? 0 : whole;
};

/**
 * `n`'s size in words for a sentence: the floored whole coins, except that a
 * real amount under one coin reads "less than 1" (6 silver at 10:1 is 0.6
 * gold: "6 silver → less than 1 gold", never "→ 0 gold"). With `short`, the
 * compact "<1" a figure column uses.
 */
export const displayCoinsText = (n, { short = false } = {}) => {
  const size = Number.isFinite(n) ? Math.abs(n) : 0;
  const whole = displayCoins(size);
  if (whole === 0 && size > 1e-9) return short ? '<1' : 'less than 1';
  return String(whole);
};
