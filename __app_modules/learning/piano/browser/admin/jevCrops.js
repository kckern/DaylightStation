/**
 * Crops of the engraved score for the Jev boundary scorer, and the request that
 * sends them (POST /api/v1/admin/sheet-music/propose).
 *
 * One PNG per barline Jev judges: up to two bars either side, from the barline's
 * own system (see cropPlan), with a red triangle over the barline after bar k.
 * Jev takes 280-1568 px per side and its adapter throws outside that, so each
 * crop is scaled to fit 1568 and padded with white up to 280.
 *
 * The SVG is the live engraving serialized as-is, not cut down to the poster
 * allow-list: a crop is rasterized here through an <img> (which runs no scripts
 * and loads nothing external) and only the PNG leaves the page, so it never
 * needs to pass svgSafety, and the poster list drops things a crop wants to keep.
 */
import { daylightApiResponse } from "../../../../../frontend/src/lib/api.mjs";

const PROPOSE_PATH = '/api/v1/admin/sheet-music/propose';
export const CROP_MIN_SIDE = 280;
export const CROP_MAX_SIDE = 1568;
/** Upscale small crops for legibility, but not past this. */
const MAX_SCALE = 2;
/** Room around the bars' staff boxes for stems, ledger lines and the marker. */
const PAD_X = 6;
const PAD_Y = 24;
const MARKER = 9;

const GAP = 16;

const sameSystem = (b, ref) => Boolean(b && ref && b.top < ref.bottom && b.bottom > ref.top);

function union(list, bounds, measures) {
  let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
  for (const i of list) {
    const b = bounds[measures[i].index];
    left = Math.min(left, b.left); right = Math.max(right, b.right);
    top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom);
  }
  const x = Math.max(0, left - PAD_X);
  const y = Math.max(0, top - PAD_Y);
  return { x, y, width: right + PAD_X - x, height: bottom + PAD_Y - y };
}

/**
 * What to show for the barline after layout position k: up to two bars either
 * side, taken only from bars on the same engraved system and in engraved order
 * (consecutive `measures[i].index`). When the barline ends a system, or the next
 * position is not the next engraved bar (an all-rest bar skipped, a jump), the
 * two sides are separate strips drawn side by side with the marker at the seam.
 * Coordinates are the engraving's px; `dx` places each strip in the composite.
 * A two-strip plan is a "seam": the server asks Jev about the end of the left piece.
 * @param {Array<{index:number}>} measures - layout.measures
 * @param {Array<{left,right,top,bottom}|null>} bounds - per engraved bar (extractMeasureBounds)
 * @returns {{ strips: Array<{x,y,width,height,dx}>, width: number, height: number,
 *   marker: { x: number, y: number } }|null} null when bounds are missing
 */
export function cropPlan(measures, bounds, k) {
  const n = measures?.length || 0;
  if (!Number.isInteger(k) || k < 0 || k >= n - 1) return null;
  const boundOf = (i) => bounds?.[measures[i]?.index] || null;
  const at = boundOf(k);
  const next = boundOf(k + 1);
  if (!at || !next) return null;
  const consecutive = (i) => measures[i + 1].index === measures[i].index + 1;
  const left = [k];
  if (k - 1 >= 0 && consecutive(k - 1) && sameSystem(boundOf(k - 1), at)) left.unshift(k - 1);
  const right = [k + 1];
  if (k + 2 < n && consecutive(k + 1) && sameSystem(boundOf(k + 2), next)) right.push(k + 2);

  if (consecutive(k) && sameSystem(next, at)) {
    const strip = { ...union([...left, ...right], bounds, measures), dx: 0 };
    return { strips: [strip], width: strip.width, height: strip.height, marker: { x: at.right - strip.x, y: at.top - strip.y } };
  }
  const a = { ...union(left, bounds, measures), dx: 0 };
  const b = { ...union(right, bounds, measures), dx: 0 };
  b.dx = a.width + GAP;
  return {
    strips: [a, b],
    width: a.width + GAP + b.width,
    height: Math.max(a.height, b.height),
    marker: { x: a.width + GAP / 2, y: at.top - a.y },
  };
}

/** True when every sampled pixel is (near) white or transparent: the crop shows nothing. */
export function isBlank(data, { step = 16, threshold = 245 } = {}) {
  for (let i = 0; i + 3 < data.length; i += 4 * step) {
    if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) return false;
  }
  return true;
}

/**
 * Canvas size for a crop of `width` x `height` source px: the content scaled to
 * fit CROP_MAX_SIDE (and at most MAX_SCALE up), centred on white padding that
 * brings each side to at least CROP_MIN_SIDE.
 * @returns {{ scale:number, width:number, height:number, offsetX:number, offsetY:number,
 *   contentWidth:number, contentHeight:number }|null}
 */
export function cropCanvasSize(width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const scale = Math.min(MAX_SCALE, CROP_MAX_SIDE / width, CROP_MAX_SIDE / height);
  const contentWidth = Math.max(1, Math.min(CROP_MAX_SIDE, Math.round(width * scale)));
  const contentHeight = Math.max(1, Math.min(CROP_MAX_SIDE, Math.round(height * scale)));
  const canvasWidth = Math.max(CROP_MIN_SIDE, contentWidth);
  const canvasHeight = Math.max(CROP_MIN_SIDE, contentHeight);
  return {
    scale,
    width: canvasWidth,
    height: canvasHeight,
    offsetX: Math.floor((canvasWidth - contentWidth) / 2),
    offsetY: Math.floor((canvasHeight - contentHeight) / 2),
    contentWidth,
    contentHeight,
  };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(Object.assign(new Error('The engraving could not be rasterized'), { code: 'crop-failed' }));
    img.src = url;
  });
}

const toPng = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(blob) : reject(Object.assign(new Error('toBlob gave nothing'), { code: 'crop-failed' }))), 'image/png');
});

const cropError = (message, k) => Object.assign(new Error(message), { code: 'crop-failed', barline: k });
const PLACEHOLDER = { width: '__CROP_W__', height: '__CROP_H__', viewBox: '__CROP_VB__' };

/**
 * PNG crops of the engraving, one per barline in `plans` (k → cropPlan). Each
 * strip is rasterized on its own from a copy of the SVG whose viewBox is just that
 * strip, at the size it is drawn, so no image is ever the size of the whole score.
 * A crop that comes out blank (white) is an error: Jev would be judging nothing.
 * @param {SVGSVGElement} svg - the engraving on screen (not modified)
 * @param {Map<number, object>} plans
 * @returns {Promise<Map<number, Blob>>}
 * @throws {Error} code `crop-failed` (with `barline`)
 */
export async function renderCrops(svg, plans) {
  if (!svg) throw cropError('No engraved svg');
  const declaredWidth = Number(svg.getAttribute('width')) || svg.clientWidth || 0;
  const declaredHeight = Number(svg.getAttribute('height')) || svg.clientHeight || 0;
  if (!(declaredWidth > 0) || !(declaredHeight > 0)) throw cropError('The engraved svg has no size');
  const vb = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 ? vb : [0, 0, declaredWidth];
  const unitsPerPx = vw / declaredWidth;
  const clone = svg.cloneNode(true);
  clone.removeAttribute('style');
  for (const [name, value] of Object.entries(PLACEHOLDER)) clone.setAttribute(name, value);
  const template = new XMLSerializer().serializeToString(clone);
  const r = (n) => Math.round(n * 1000) / 1000;

  const out = new Map();
  for (const [k, plan] of plans) {
    const size = cropCanvasSize(plan.width, plan.height);
    if (!size) throw cropError(`Barline ${k} has an empty crop`, k);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.width, size.height);
    for (const strip of plan.strips) {
      const w = Math.max(1, Math.round(strip.width * size.scale));
      const h = Math.max(1, Math.round(strip.height * size.scale));
      const text = template
        .replace(`width="${PLACEHOLDER.width}"`, `width="${w}"`)
        .replace(`height="${PLACEHOLDER.height}"`, `height="${h}"`)
        .replace(`viewBox="${PLACEHOLDER.viewBox}"`, `viewBox="${r(vx + strip.x * unitsPerPx)} ${r(vy + strip.y * unitsPerPx)} ${r(strip.width * unitsPerPx)} ${r(strip.height * unitsPerPx)}"`);
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      try {
        const img = await loadImage(url);
        ctx.drawImage(img, size.offsetX + strip.dx * size.scale, size.offsetY, w, h);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (isBlank(ctx.getImageData(0, 0, size.width, size.height).data)) throw cropError(`Barline ${k} rendered blank`, k);
    // The barline in question: a red triangle above it, pointing down at the staff.
    const mx = size.offsetX + plan.marker.x * size.scale;
    const tip = Math.max(MARKER * 1.6, size.offsetY + plan.marker.y * size.scale - 2);
    ctx.fillStyle = '#e03131';
    ctx.beginPath();
    ctx.moveTo(mx - MARKER, tip - MARKER * 1.6);
    ctx.lineTo(mx + MARKER, tip - MARKER * 1.6);
    ctx.lineTo(mx, tip);
    ctx.closePath();
    ctx.fill();
    out.set(k, await toPng(canvas));
  }
  return out;
}

/**
 * POSTs features and crops. Resolves `{ ok: true, result }` or
 * `{ ok: false, code, status }` (`code` null when the body had none).
 */
export async function requestJevProposal({ id, features, crops, measureCount, targetLen, seams = [] }) {
  const body = new FormData();
  body.append('features', JSON.stringify({ features, measureCount, targetLen, seams }));
  for (const [k, blob] of crops) body.append(`crop_${k}`, blob, `crop_${k}.png`);
  let response;
  try {
    response = await daylightApiResponse(`${PROPOSE_PATH}?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      data: body,
    });
  } catch (err) {
    return { ok: false, code: 'network', status: 0, message: err?.message };
  }
  let doc = null;
  try { doc = await response.json(); } catch { doc = null; }
  if (response.ok) return { ok: true, result: doc || {} };
  return { ok: false, code: typeof doc?.error === 'string' ? doc.error : null, status: response.status };
}
