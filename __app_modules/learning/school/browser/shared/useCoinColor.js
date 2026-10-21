/**
 * A coin colour from a School token, as the hex CoinIcon needs. CoinIcon
 * builds its tint ladder from a hex (`lib/icons/iconColor.js`), so it cannot
 * take `var(--school-coin-silver)`. This returns `[color, ref]`: put `ref` on
 * an element inside `.school-app` (where the tokens live and inherit) and the
 * token is read off it when it mounts. Unset or not a hex (tests with no
 * stylesheet) falls back to the same value the stylesheet sets.
 */
import { useCallback, useState } from 'react';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export const COIN_TOKENS = Object.freeze({
  silver: ['--school-coin-silver', '#c0c0c0'],
});

export function useCoinColor(coin) {
  const [name, fallback] = COIN_TOKENS[coin];
  const [color, setColor] = useState(fallback);
  const ref = useCallback((el) => {
    if (!el || typeof getComputedStyle !== 'function') return;
    const value = getComputedStyle(el).getPropertyValue(name).trim();
    if (HEX.test(value)) setColor(value);
  }, [name]);
  return [color, ref];
}

export default useCoinColor;
