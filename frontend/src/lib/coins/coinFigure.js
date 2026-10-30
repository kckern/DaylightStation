/**
 * The whole coins a screen shows. Gold is stored fractional (the week close
 * converts silver → gold at 10:1, so 56 silver is 5.6 gold); a child is never
 * shown a decimal, so every coin figure on screen goes through here.
 *
 * Mirrors `displayCoins` in `__app_modules/money/economy/server/domain/coins.mjs`
 * (the browser cannot import server code; keep the two in step by hand).
 */

/** A balance or amount, floored: 5.6 → 5. Anything unreadable → 0. */
export const coinFigure = (n) => (Number.isFinite(n) ? Math.floor(n + 1e-9) : 0);

/** A signed delta's size, floored: −5.6 → 5, +5.6 → 5 (the caller adds the sign). */
export const coinMagnitude = (delta) => coinFigure(Math.abs(delta));

/**
 * Whole coins still to earn for `price` with `have`, rounded UP: 0.4 gold
 * short reads "1 more", matching the floored balance a screen shows (5 of 6).
 */
export const coinsShort = (price, have) => {
  const short = (Number.isFinite(price) ? price : 0) - (Number.isFinite(have) ? have : 0);
  return short > 1e-9 ? Math.ceil(short - 1e-9) : 0;
};

export default coinFigure;
