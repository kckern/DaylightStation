/**
 * deriveMatte — pure color math. Given a painting's average RGB, return a
 * muted matte palette (paper plane + beveled cut). No I/O.
 *
 * - Colorful paintings → "match": the painting's own hue, clamped muted.
 * - Near-greyscale paintings → "neutral": warm browns/cream.
 * Mat brightness tracks the painting's lightness. Nothing vibrant escapes.
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max]; // all 0..1
}

function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

const toHex = (rgb) =>
  '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');

// Multiply an RGB color's HSL lightness by `factor`, return RGB.
function adjustLightness([r, g, b], factor) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const nl = clamp(l * factor, 0, 1);
  const c = (1 - Math.abs(2 * nl - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = nl - c / 2;
  const hp = h * 6;
  let rr, gg, bb;
  if (hp < 1) [rr, gg, bb] = [c, x, 0];
  else if (hp < 2) [rr, gg, bb] = [x, c, 0];
  else if (hp < 3) [rr, gg, bb] = [0, c, x];
  else if (hp < 4) [rr, gg, bb] = [0, x, c];
  else if (hp < 5) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return [(rr + m) * 255, (gg + m) * 255, (bb + m) * 255];
}

// Paintings darker/lighter than these are treated as the dark/light extremes.
const V_CLAMP_LO = 0.20;
const V_CLAMP_HI = 0.85;

// Track painting lightness `v` into a muted band [lo, hi].
function mapValue(v, lo, hi) {
  const vc = clamp(v, V_CLAMP_LO, V_CLAMP_HI);
  return lo + ((vc - V_CLAMP_LO) / (V_CLAMP_HI - V_CLAMP_LO)) * (hi - lo);
}

const SAT_CEIL = 0.18;     // muted saturation ceiling
const GREYSCALE = 0.10;    // below this avg saturation → warm-neutral branch
const NEUTRAL_HUE = 30 / 360; // amber/brown

export function deriveMatte(avgRGB) {
  const [h, s, v] = rgbToHsv(avgRGB);
  let H, S, V, branch;
  if (s < GREYSCALE) {
    H = NEUTRAL_HUE; S = 0.13; V = mapValue(v, 0.30, 0.60); branch = 'neutral';
  } else {
    H = h; S = Math.min(s, SAT_CEIL); V = mapValue(v, 0.30, 0.52); branch = 'match';
  }
  const baseRgb = hsvToRgb(H, S, V);
  // Bevel factors model light from the top-left: lit faces (>1.0) bottom/right, shadowed (<1.0) top/left.
  return {
    branch,
    base: toHex(baseRgb),
    glow: toHex(adjustLightness(baseRgb, 1.16)),
    edge: toHex(adjustLightness(baseRgb, 0.82)),
    bevelTop: toHex(adjustLightness(baseRgb, 0.80)),
    bevelLeft: toHex(adjustLightness(baseRgb, 0.88)),
    bevelRight: toHex(adjustLightness(baseRgb, 1.12)),
    bevelBottom: toHex(adjustLightness(baseRgb, 1.20)),
  };
}

export default deriveMatte;
