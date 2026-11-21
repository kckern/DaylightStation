/**
 * Whether a provider logo is readable on the handoff's dark field, measured from
 * its pixels: the mean relative luminance of its opaque pixels against the field,
 * as a WCAG contrast ratio. A logo under MIN_CONTRAST is drawn on a light plate
 * (Disney+'s navy wordmark measures about 2.5 against the field).
 *
 * Reference: __docs/reference/media/provenance.md
 */

/** The field colour (#05060a) as relative luminance. */
export const FIELD_LUMINANCE = 0.0019;
// WCAG 1.4.11 / large text: 3:1. Logos are large graphics; Netflix red (4.2) and
// Kanopy red pass, Disney+ navy (2.5) does not.
export const MIN_CONTRAST = 3;

const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

/**
 * @param {Uint8ClampedArray|number[]} rgba - pixel data (r, g, b, a, ...)
 * @returns {number|null} mean relative luminance of pixels at least half opaque, or null if none
 */
export function meanLuminance(rgba) {
  let sum = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    sum += 0.2126 * lin(rgba[i]) + 0.7152 * lin(rgba[i + 1]) + 0.0722 * lin(rgba[i + 2]);
    n += 1;
  }
  return n ? sum / n : null;
}

export function contrastOnField(luminance) {
  return (luminance + 0.05) / (FIELD_LUMINANCE + 0.05);
}

/** True when the logo needs a light plate behind it. Unknown (no pixels) -> false. */
export function needsPlate(rgba) {
  const l = meanLuminance(rgba);
  return l != null && contrastOnField(l) < MIN_CONTRAST;
}

/**
 * Measures a loaded logo image in the browser. Returns false when it cannot
 * (no canvas, tainted image): the logo is then drawn as is.
 * @param {HTMLImageElement} img
 */
export function imageNeedsPlate(img) {
  try {
    const w = Math.min(320, img.naturalWidth || img.width || 0);
    const h = Math.round(w * ((img.naturalHeight || img.height || 1) / (img.naturalWidth || img.width || 1)));
    if (!w || !h || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    return needsPlate(ctx.getImageData(0, 0, w, h).data);
  } catch (_) {
    return false;
  }
}
