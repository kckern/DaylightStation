// artModes.js — pure view-mode model + object-fit geometry for ArtMode. No DOM.
// Five modes cycle museum → immersive.
import { coverCropPerSide } from './artLayout.js';

const SW = 16, SH = 9;

export const VIEW_MODES = [
  { name: 'gallery',        frame: true,  fullWindow: false, fit: 'gallery', placard: true  },
  { name: 'framed-contain', frame: true,  fullWindow: false, fit: 'contain', placard: true  },
  { name: 'framed-cover',   frame: true,  fullWindow: false, fit: 'cover',   placard: true  },
  { name: 'bare-contain',   frame: false, fullWindow: true,  fit: 'contain', placard: false },
  { name: 'bare-cover',     frame: false, fullWindow: true,  fit: 'cover',   placard: false },
];

export function modeIndexByName(name) {
  const i = VIEW_MODES.findIndex((m) => m.name === name);
  return i === -1 ? 0 : i;
}

export const nextMode = (i) => (i + 1) % VIEW_MODES.length;
export const prevMode = (i) => (i - 1 + VIEW_MODES.length) % VIEW_MODES.length;

/**
 * Per-image default view-mode index. A SINGLE that cover-fills the bare frame
 * window with ≤ `fillCrop` (fraction) per side starts mat-less, in `framed-cover`
 * (frame on, image bleeds to fill); diptychs and tighter singles fall back to
 * `fallback` (the matted `gallery` by default). With `fillCrop` 0 the answer is
 * always `fallback`, so the feature is off and behavior is unchanged. Tab cycling
 * is unaffected — this only chooses where an untouched image *starts*.
 *
 * @param {object} o
 * @param {'single'|'diptych'} o.mode  content mode of the artwork
 * @param {number[]} o.ratios  art aspect ratios (w/h)
 * @param {{top,right,bottom,left}} o.frame  frame window insets, %
 * @param {number} [o.fillCrop]  matless-fill budget, fraction (e.g. 0.125)
 * @param {string} [o.fallback]  mode name for non-qualifying art (default 'gallery')
 * @returns {number} index into VIEW_MODES
 */
export function defaultModeIndex({ mode, ratios, frame, fillCrop = 0, fallback = 'gallery' }) {
  const fb = modeIndexByName(fallback);
  if (mode === 'diptych' || !(fillCrop > 0) || !ratios?.length) return fb;
  const winAR = (SW - ((frame.left + frame.right) / 100) * SW)
              / (SH - ((frame.top + frame.bottom) / 100) * SH);
  const need = coverCropPerSide(winAR, ratios[0]);
  return need <= fillCrop + 1e-9 ? modeIndexByName('framed-cover') : fb;
}

// Per-panel window insets (% of stage) for the object-fit modes (2-5).
// count: 1 single | 2 diptych. fullWindow: true → full stage, else frame insets.
export function objectFitWindows({ count, frame, fullWindow }) {
  const win = fullWindow ? { top: 0, right: 0, bottom: 0, left: 0 } : frame;
  const openLeft = win.left;
  const openRight = 100 - win.right;
  const openWidth = openRight - openLeft;
  if (count === 2) {
    const mid = openLeft + openWidth / 2;
    return [
      { top: win.top, bottom: win.bottom, left: win.left, right: 100 - mid,
        centerXPct: (openLeft + mid) / 2, widthPct: openWidth / 2 },
      { top: win.top, bottom: win.bottom, left: mid, right: win.right,
        centerXPct: (mid + openRight) / 2, widthPct: openWidth / 2 },
    ];
  }
  return [
    { top: win.top, bottom: win.bottom, left: win.left, right: win.right,
      centerXPct: openLeft + openWidth / 2, widthPct: openWidth },
  ];
}

export default VIEW_MODES;
