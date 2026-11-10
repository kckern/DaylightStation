/**
 * The whole coins a screen shows. Gold is stored fractional (the week close
 * converts silver → gold at 10:1, so 56 silver is 5.6 gold); a child is never
 * shown a decimal, so every coin figure on screen goes through here.
 *
 * Mirrors `displayCoins` in `__app_modules/money/economy/server/domain/coins.mjs`
 * (the browser cannot import server code; keep the two in step by hand).
 */

/**
 * A balance or amount in whole coins, rounded toward zero: 5.6 → 5, and a
 * negative never reads past its true size (−0.4 → 0, −5.6 → −5). Anything
 * unreadable → 0. Never −0.
 */
export const coinFigure = (n) => {
  if (!Number.isFinite(n)) return 0;
  const whole = n < 0 ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return whole === 0 ? 0 : whole;
};

/** A signed delta's size, floored: −5.6 → 5, +5.6 → 5 (the caller adds the sign). */
export const coinMagnitude = (delta) => coinFigure(Math.abs(delta));

/**
 * The size of a delta or balance as a screen writes it: the floored whole
 * coins, except that a real amount under one coin reads "<1" rather than "0"
 * (6 silver at 10:1 is 0.6 gold: the ledger leg says "+<1", never "+0").
 * Zero and unreadable read "0".
 */
export const coinMagnitudeText = (n) => {
  const size = Number.isFinite(n) ? Math.abs(n) : 0;
  const whole = coinMagnitude(size);
  return whole === 0 && size > 1e-9 ? '<1' : String(whole);
};

/**
 * Whole coins still to earn for `price` with `have`, rounded UP: 0.4 gold
 * short reads "1 more", matching the floored balance a screen shows (5 of 6).
 */
export const coinsShort = (price, have) => {
  const short = (Number.isFinite(price) ? price : 0) - (Number.isFinite(have) ? have : 0);
  return short > 1e-9 ? Math.ceil(short - 1e-9) : 0;
};

export default coinFigure;
