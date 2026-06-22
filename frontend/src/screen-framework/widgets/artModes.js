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

const ANCHOR_KEYWORDS = new Set(['top', 'bottom', 'left', 'right', 'center']);

/**
 * Sanitize a per-item `crop_anchor` hint (metadata.yaml) into a safe CSS
 * `object-position`, or null. The anchor decides which edge a cover-crop KEEPS:
 * `top` pins the image's top to the window so the crop is taken off the bottom
 * (keeps heads). Accepts 1–2 tokens, each a keyword (top|bottom|left|right|center)
 * or an `NN%`; anything else returns null so no arbitrary text reaches a style.
 * Only affects `object-fit: cover` images.
 * @param {string} anchor
 * @returns {string|null}
 */
export function cropFocus(anchor) {
  if (typeof anchor !== 'string') return null;
  const tokens = anchor.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2);
  if (!tokens.length) return null;
  const ok = tokens.every((t) => ANCHOR_KEYWORDS.has(t) || /^\d{1,3}%$/.test(t));
  return ok ? tokens.join(' ') : null;
}

/**
 * Aspect (w/h) of the ArtMode opening a panel fills. fullWindow → the whole 16:9
 * stage; otherwise the frame insets shrink it (≈2:1 for the default gold frame).
 * @param {{frame:{top,right,bottom,left}, fullWindow:boolean}} o
 */
export function openingAspect({ frame, fullWindow }) {
  if (fullWindow) return SW / SH;
  const w = SW - ((frame.left + frame.right) / 100) * SW;
  const h = SH - ((frame.top + frame.bottom) / 100) * SH;
  return w / h;
}

/**
 * CSS to cover-fill a keep-band into an opening, on whichever axis the crop
 * defines. VERTICAL band [top, 100−bottom] (% of source height): full-width
 * `<img width:100%; height:auto>`, cover-scaled, horizontally centred, band top
 * aligned. HORIZONTAL band [left, 100−right] (% of source width, a panorama):
 * full-height `<img height:100%; width:auto>`, cover-scaled, vertically centred,
 * band left aligned. Axis is chosen by which margins are present (left/right →
 * horizontal). Pure + px-independent (translate % is relative to the img's box).
 * @param {{top?:number, bottom?:number, left?:number, right?:number}} crop
 * @param {number} srcRatio  source aspect (w/h)
 * @param {number} openingRatio  opening aspect (w/h)
 * @returns {{transform:string, transformOrigin:'top left', scale:number, axis:'vertical'|'horizontal'}}
 */
export function cropBandFit(crop, srcRatio, openingRatio) {
  const frac = (v) => Math.max(0, Math.min(90, Number(v) || 0)) / 100;
  const r3 = (n) => (Object.is(n, -0) ? '-0' : `${Number(n.toFixed(3))}`);
  const out = (tx, ty, scale, axis) => ({
    transform: `translate(${r3(tx)}%, ${r3(ty)}%) scale(${Number(scale.toFixed(4))})`,
    transformOrigin: 'top left', scale, axis,
  });
  const horizontal = Number.isFinite(crop?.left) || Number.isFinite(crop?.right);
  if (horizontal) {
    const l = frac(crop.left);
    const r = frac(crop.right);
    const bw = Math.max(0.1, 1 - l - r);               // band width fraction of source
    const scale = Math.max(1, openingRatio / (srcRatio * bw));
    return out(-(scale * l) * 100, -((scale - 1) / 2) * 100, scale, 'horizontal');
  }
  const t = frac(crop?.top);
  const b = frac(crop?.bottom);
  const bh = Math.max(0.1, 1 - t - b);                 // band height fraction of source
  const scale = Math.max(1, srcRatio / (openingRatio * bh));
  return out(-((scale - 1) / 2) * 100, -(scale * t) * 100, scale, 'vertical');
}

/**
 * Per-image matless-fill decision (with reasoning, for logging). Cover-filling the
 * bare frame opening crops exactly ONE axis: a SINGLE narrower than the opening
 * fills the width and trims top/bottom (the vertical budget `cropV`); one wider
 * fills the height and trims left/right (the horizontal budget `cropH`). If the
 * needed per-side crop is within that axis's budget the image starts mat-less in
 * `framed-cover` (frame on, image bleeds to fill); diptychs and over-budget singles
 * fall back to `fallback` (the matted `gallery` by default). With both budgets 0
 * the result is always `fallback` (feature off). Tab cycling is unaffected — this
 * only chooses where an untouched image *starts*.
 *
 * @param {object} o
 * @param {'single'|'diptych'} o.mode  content mode of the artwork
 * @param {number[]} o.ratios  art aspect ratios (w/h)
 * @param {{top,right,bottom,left}} o.frame  frame window insets, %
 * @param {number} [o.cropV]  top/bottom crop budget, fraction (e.g. 0.14)
 * @param {number} [o.cropH]  left/right crop budget, fraction (e.g. 0.25)
 * @param {string} [o.fallback]  mode name for non-qualifying art (default 'gallery')
 * @returns {{index:number, view:string, qualified:boolean, winAR:number|null,
 *            axis:'top-bottom'|'left-right'|null, need:number|null, budget:number}}
 */
export function fillDecision({ mode, ratios, frame, cropV = 0, cropH = 0, fallback = 'gallery', crop = null }) {
  const fb = modeIndexByName(fallback);
  const matted = () => ({ index: fb, view: VIEW_MODES[fb].name, qualified: false, winAR: null, axis: null, need: null, budget: 0 });

  // Explicit per-work crop overrides the auto gate.
  if (crop && crop.enabled === false) return matted();
  const horizontalBand = !!crop && (Number.isFinite(crop.left) || Number.isFinite(crop.right));
  const hasBand = !!crop && crop.enabled !== false
    && (horizontalBand || Number.isFinite(crop.top) || Number.isFinite(crop.bottom));
  if (hasBand && mode !== 'diptych') {
    const fc = modeIndexByName('framed-cover');
    return { index: fc, view: VIEW_MODES[fc].name, qualified: true, winAR: null, axis: horizontalBand ? 'left-right' : 'top-bottom', need: null, budget: 0 };
  }

  if (mode === 'diptych' || !(cropV > 0 || cropH > 0) || !ratios?.length) return matted();
  const winAR = (SW - ((frame.left + frame.right) / 100) * SW)
              / (SH - ((frame.top + frame.bottom) / 100) * SH);
  const vertical = ratios[0] <= winAR;        // narrower art → fills width, crops top/bottom
  const axis = vertical ? 'top-bottom' : 'left-right';
  const budget = vertical ? cropV : cropH;
  const need = coverCropPerSide(winAR, ratios[0]);
  const qualified = budget > 0 && need <= budget + 1e-9;
  const index = qualified ? modeIndexByName('framed-cover') : fb;
  return { index, view: VIEW_MODES[index].name, qualified, winAR, axis, need, budget };
}

/**
 * Per-image default view-mode index. Thin wrapper over {@link fillDecision} when
 * only the index is needed (e.g. tests, simple callers).
 * @returns {number} index into VIEW_MODES
 */
export function defaultModeIndex(o) {
  return fillDecision(o).index;
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
