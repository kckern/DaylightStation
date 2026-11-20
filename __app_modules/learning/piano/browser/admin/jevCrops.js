/**
 * Crops of the engraved score for the Jev boundary scorer, and the request that
 * sends them (POST /api/v1/admin/sheet-music/propose).
 *
 * One PNG per barline Jev judges: up to two bars either side (layout positions
 * k-1..k+2, each mapped to its engraved bar through `measures[i].index`), with a
 * red triangle over the barline after bar k, drawn from the engraving on screen.
 * Jev takes 280-1568 px per side and its adapter throws outside that, so each
 * crop is scaled to fit 1568 and padded with white up to 280.
 *
 * The SVG is the live engraving serialized as-is, not cut down to the poster
 * allow-list: a crop is rasterized here through an <img> (which runs no scripts
 * and loads nothing external) and only the PNG leaves the page, so it never
 * needs to pass svgSafety, and the poster list drops things a crop wants to keep.
 */
import { buildHeaders } from "../../../../../frontend/src/lib/api.mjs";

const PROPOSE_PATH = '/api/v1/admin/sheet-music/propose';
export const CROP_MIN_SIDE = 280;
export const CROP_MAX_SIDE = 1568;
/** Upscale small crops for legibility, but not past this. */
const MAX_SCALE = 2;
/** Room around the bars' staff boxes for stems, ledger lines and the marker. */
const PAD_X = 6;
const PAD_Y = 24;
const MARKER = 9;

/**
 * The region of the engraving to show for the barline after layout position k.
 * @param {Array<{index:number}>} measures - layout.measures
 * @param {Array<{left,right,top,bottom}|null>} bounds - per engraved bar (extractMeasureBounds)
 * @returns {{ x:number, y:number, width:number, height:number, markerX:number }|null}
 */
export function cropBox(measures, bounds, k) {
  const n = measures?.length || 0;
  if (!Number.isInteger(k) || k < 0 || k >= n - 1) return null;
  let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
  for (let i = Math.max(0, k - 1); i <= Math.min(n - 1, k + 2); i += 1) {
    const b = bounds?.[measures[i]?.index];
    if (!b) continue;
    left = Math.min(left, b.left); right = Math.max(right, b.right);
    top = Math.min(top, b.top); bottom = Math.max(bottom, b.bottom);
  }
  const at = bounds?.[measures[k]?.index];
  if (!at || !(right > left) || !(bottom > top)) return null;
  const x = Math.max(0, left - PAD_X);
  const y = Math.max(0, top - PAD_Y);
  return { x, y, width: right + PAD_X - x, height: bottom + PAD_Y - y, markerX: at.right };
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

/**
 * PNG crops of the engraving, one per barline in `boxes` (k → cropBox).
 * @param {SVGSVGElement} svg - the engraving on screen (not modified)
 * @param {Map<number, object>} boxes
 * @returns {Promise<Map<number, Blob>>}
 */
export async function renderCrops(svg, boxes) {
  if (!svg) throw Object.assign(new Error('No engraved svg'), { code: 'crop-failed' });
  const declaredWidth = Number(svg.getAttribute('width')) || svg.clientWidth || 0;
  const text = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const ratio = declaredWidth > 0 ? img.naturalWidth / declaredWidth : 1;
    const out = new Map();
    for (const [k, box] of boxes) {
      const size = cropCanvasSize(box.width, box.height);
      if (!size) continue;
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(
        img,
        box.x * ratio, box.y * ratio, box.width * ratio, box.height * ratio,
        size.offsetX, size.offsetY, size.contentWidth, size.contentHeight,
      );
      // The barline in question: a red triangle above it, pointing down.
      const mx = size.offsetX + (box.markerX - box.x) * size.scale;
      const my = size.offsetY + 2;
      ctx.fillStyle = '#e03131';
      ctx.beginPath();
      ctx.moveTo(mx - MARKER, my);
      ctx.lineTo(mx + MARKER, my);
      ctx.lineTo(mx, my + MARKER * 1.6);
      ctx.closePath();
      ctx.fill();
      out.set(k, await toPng(canvas));
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * POSTs features and crops. Resolves `{ ok: true, result }` or
 * `{ ok: false, code, status }` (`code` null when the body had none).
 */
export async function requestJevProposal({ id, features, crops, measureCount, targetLen }) {
  const body = new FormData();
  body.append('features', JSON.stringify({ features, measureCount, targetLen }));
  for (const [k, blob] of crops) body.append(`crop_${k}`, blob, `crop_${k}.png`);
  let response;
  try {
    response = await fetch(`${PROPOSE_PATH}?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: buildHeaders(localStorage.getItem('ds_token'), false),
      body,
    });
  } catch (err) {
    return { ok: false, code: 'network', status: 0, message: err?.message };
  }
  let doc = null;
  try { doc = await response.json(); } catch { doc = null; }
  if (response.ok) return { ok: true, result: doc || {} };
  return { ok: false, code: typeof doc?.error === 'string' ? doc.error : null, status: response.status };
}
