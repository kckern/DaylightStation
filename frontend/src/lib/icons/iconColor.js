/**
 * Shade derivation for the parameterised economy icons (TicketIcon, CoinIcon,
 * GemIcon). Each of those illustrations was drawn in one hue with several
 * fixed tints and shades; a caller passes ONE colour and the icon rebuilds its
 * tint ladder around it, so a ruby, a sapphire and an emerald are the same
 * component with a different `color`.
 *
 * Only hex colours are parsed (`#rgb`, `#rrggbb`). That is deliberate: the
 * derivation needs a real colour to shift, and `currentColor` or a CSS token
 * cannot be shifted here. Pass a resolved hex; if a caller has a token, read it
 * with getComputedStyle first.
 */

export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: hue * 60, s, l };
}

export function hslToHex({ h, s, l }) {
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = lig - c / 2;
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The base colour re-lit at a given lightness (0..1), keeping hue and
 * saturation. Optional `s` overrides saturation (a highlight is usually a
 * little less saturated than the body). An unparseable colour returns the
 * input unchanged so a bad value renders visibly wrong rather than throwing
 * inside a wall panel.
 */
export function relight(color, l, s = null) {
  const hsl = hexToHsl(color);
  if (!hsl) return color;
  return hslToHex({ h: hsl.h, s: s ?? hsl.s, l });
}
