/**
 * Optical measurement of a rendered School page — reads INK, not records.
 *
 * WHY THIS EXISTS
 *   `DocumentPdfRenderer` draws each OMR bubble and, in the same statement,
 *   records its centre and radius into the form map. `VirtualOmrReader` then
 *   grades against that same record. Writer and reader share one number, so a
 *   drift between the recorded geometry and where the ink actually landed is
 *   invisible to every structural test and to the form-map golden — both sides
 *   agree, the suite is green, and a real scanner reading real paper marks a
 *   child's right answer wrong.
 *
 *   Everything in this module therefore measures PIXELS. It is handed a
 *   rasterized page and nothing else: no form map, no code map, no theme. The
 *   caller compares what this found against what the renderer claimed.
 *
 * WHAT IT MEASURES, AND HOW
 *   Bubbles are unfilled vector circles, so each one encloses a hole. The
 *   detector finds holes structurally — flood the white background inward from
 *   the page border, and any white left unreached is enclosed by ink — then, for
 *   each hole of plausible size, casts 720 rays outward from the hole's centroid
 *   and locates the surrounding stroke's intensity centroid along each ray at
 *   sub-pixel resolution. A least-squares circle through those 720 centreline
 *   points gives the centre and radius, and the fit residual proves the thing
 *   measured was actually a circle.
 *
 *   The size band the detector accepts is deliberately WIDE (radius 3pt–11pt
 *   against a theme radius of 6.5pt). A narrow band aimed at the expected value
 *   would find only what it was told to find; a wide one means a bubble printed
 *   at the wrong size goes missing from the results and the caller's count
 *   assertion fails.
 *
 * COORDINATES
 *   `pdftoppm -r DPI` maps PDF point (0,0) to the top-left corner of pixel
 *   (0,0), so the CENTRE of pixel i sits at (i + 0.5) * 72/DPI points. Every
 *   conversion here goes through `pxToPt`, and getting that half-pixel wrong is
 *   a uniform 0.12pt bias at 300dpi — the same order as the drift being hunted.
 *
 * @module tests/_lib/school/opticalScan
 */

/** Points per inch, which is what a PDF unit is. */
const PT_PER_INCH = 72;

/** Grey at or below this (0..255) is ink. Mid-grey: the render is black on white. */
const INK_THRESHOLD = 128;

/** Rays cast around each candidate. 720 = one every half-degree. */
const RAY_COUNT = 720;

/** Radial sampling step, in pixels, along each ray. */
const RAY_STEP_PX = 0.25;

/** Candidate holes must sit inside this radius band, in points. Wide on purpose. */
const MIN_CANDIDATE_RADIUS_PT = 3;
const MAX_CANDIDATE_RADIUS_PT = 11;

/** A candidate's hole must be roughly as wide as it is tall. */
const MAX_BBOX_ASPECT_SKEW = 0.3;

/** The stroke found along a ray must be this thick, in points, to be a bubble rim. */
const MIN_STROKE_PT = 0.2;
const MAX_STROKE_PT = 3;

/** A fitted circle whose points scatter further than this (points, RMS) is not a circle. */
const MAX_FIT_RESIDUAL_PT = 0.4;

/**
 * Decode a PNG page into a greyscale plane plus an ink mask.
 *
 * @param {Buffer} png
 * @param {number} dpi - the density it was rasterized at
 * @returns {Promise<{width:number, height:number, dpi:number, grey:Uint8Array, ink:Uint8Array}>}
 */
export async function toPageImage(png, dpi) {
  if (!Number.isFinite(dpi) || dpi <= 0) throw new TypeError(`toPageImage needs a positive dpi, got ${dpi}`);
  const { createCanvas, loadImage } = await import('canvas');
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);

  const count = image.width * image.height;
  const grey = new Uint8Array(count);
  const ink = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    // Rec. 601 luma. The page is black on white, so any sane weighting agrees;
    // this one is stated so the threshold below means something specific.
    const value = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    grey[i] = value;
    ink[i] = value <= INK_THRESHOLD ? 1 : 0;
  }
  return { width: image.width, height: image.height, dpi, grey, ink };
}

/** Pixel-index coordinate → PDF points. The +0.5 is the pixel's centre. */
export const pxToPt = (px, dpi) => ((px + 0.5) * PT_PER_INCH) / dpi;

/** PDF points → pixels, as a length (no half-pixel offset). */
export const ptToPxLength = (pt, dpi) => (pt * dpi) / PT_PER_INCH;

/**
 * White regions the page border cannot reach — i.e. holes enclosed by ink.
 *
 * @param {{width:number,height:number,ink:Uint8Array}} page
 * @returns {Array<{pixels:number[], minX:number, maxX:number, minY:number, maxY:number, cx:number, cy:number}>}
 */
export function findEnclosedRegions(page) {
  const { width, height, ink } = page;
  const outside = new Uint8Array(width * height);
  const stack = [];

  const pushIfOpen = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (ink[index] || outside[index]) return;
    outside[index] = 1;
    stack.push(index);
  };

  for (let x = 0; x < width; x += 1) { pushIfOpen(x, 0); pushIfOpen(x, height - 1); }
  for (let y = 0; y < height; y += 1) { pushIfOpen(0, y); pushIfOpen(width - 1, y); }
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index - x) / width;
    pushIfOpen(x - 1, y); pushIfOpen(x + 1, y); pushIfOpen(x, y - 1); pushIfOpen(x, y + 1);
  }

  const seen = new Uint8Array(width * height);
  const regions = [];
  for (let start = 0; start < width * height; start += 1) {
    if (ink[start] || outside[start] || seen[start]) continue;
    seen[start] = 1;
    const pixels = [start];
    const queue = [start];
    let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    let sumX = 0; let sumY = 0;
    while (queue.length) {
      const index = queue.pop();
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      sumX += x; sumY += y;
      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || ink[next] || outside[next] || seen[next]) continue;
        seen[next] = 1;
        pixels.push(next);
        queue.push(next);
      }
    }
    regions.push({
      pixels, minX, maxX, minY, maxY, cx: sumX / pixels.length, cy: sumY / pixels.length,
    });
  }
  return regions;
}

/** Bilinear greyscale sample; off-page reads as paper white. */
function sampleGrey(page, x, y) {
  const { width, height, grey } = page;
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 255;
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1); const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0; const fy = y - y0;
  const g00 = grey[y0 * width + x0]; const g10 = grey[y0 * width + x1];
  const g01 = grey[y1 * width + x0]; const g11 = grey[y1 * width + x1];
  return g00 * (1 - fx) * (1 - fy) + g10 * fx * (1 - fy) + g01 * (1 - fx) * fy + g11 * fx * fy;
}

/**
 * Walk one ray outward and return the sub-pixel radius of the first stroke.
 *
 * The stroke's darkness centroid is used rather than a threshold crossing: the
 * rasterizer antialiases, so a 0.9pt rim spreads its ink across ~4 pixels, and
 * the intensity centroid of that spread is the geometric centreline to well
 * under a pixel.
 *
 * @returns {number|null} distance in pixels from (cx,cy), or null if no rim
 */
function measureRimAlongRay(page, cx, cy, dx, dy, { fromPx, toPx, minStrokePx, maxStrokePx }) {
  let entered = -1;
  let left = -1;
  for (let d = fromPx; d <= toPx; d += RAY_STEP_PX) {
    const value = sampleGrey(page, cx + dx * d, cy + dy * d);
    if (entered < 0) {
      if (value <= INK_THRESHOLD) entered = d;
    } else if (value > INK_THRESHOLD) { left = d; break; }
  }
  if (entered < 0 || left < 0) return null;
  const thickness = left - entered;
  if (thickness < minStrokePx || thickness > maxStrokePx) return null;

  // Weight by darkness over a window that covers the antialiased skirts too.
  const pad = 1.5;
  let weight = 0;
  let moment = 0;
  for (let d = entered - pad; d <= left + pad; d += RAY_STEP_PX) {
    const darkness = Math.max(0, 255 - sampleGrey(page, cx + dx * d, cy + dy * d));
    weight += darkness;
    moment += darkness * d;
  }
  return weight > 0 ? moment / weight : null;
}

/** Kása algebraic circle fit. Exact for noiseless points, stable for 720 of them. */
function fitCircle(points) {
  const n = points.length;
  let sx = 0; let sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  const mx = sx / n; const my = sy / n;

  let suu = 0; let suv = 0; let svv = 0; let suuu = 0; let svvv = 0; let suvv = 0; let svuu = 0;
  for (const p of points) {
    const u = p.x - mx; const v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const b1 = (suuu + suvv) / 2;
  const b2 = (svvv + svuu) / 2;
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (b2 * suu - b1 * suv) / det;
  const cx = uc + mx; const cy = vc + my;

  let sumR = 0;
  for (const p of points) sumR += Math.hypot(p.x - cx, p.y - cy);
  const r = sumR / n;
  let sumSq = 0;
  for (const p of points) { const e = Math.hypot(p.x - cx, p.y - cy) - r; sumSq += e * e; }
  return { cx, cy, r, residual: Math.sqrt(sumSq / n) };
}

/**
 * Find every printed circle on a rasterized page and measure it.
 *
 * @param {{width:number,height:number,dpi:number,grey:Uint8Array,ink:Uint8Array}} page
 * @returns {Array<{xPt:number, yPt:number, rPt:number, residualPt:number, rays:number}>}
 *   sorted top-to-bottom then left-to-right, in PDF points
 */
export function detectCircles(page) {
  const { dpi } = page;
  const minRadiusPx = ptToPxLength(MIN_CANDIDATE_RADIUS_PT, dpi);
  const maxRadiusPx = ptToPxLength(MAX_CANDIDATE_RADIUS_PT, dpi);
  const minStrokePx = ptToPxLength(MIN_STROKE_PT, dpi);
  const maxStrokePx = ptToPxLength(MAX_STROKE_PT, dpi);

  const found = [];
  for (const region of findEnclosedRegions(page)) {
    const boxW = region.maxX - region.minX + 1;
    const boxH = region.maxY - region.minY + 1;
    const span = Math.max(boxW, boxH);
    // The hole is the circle's interior, so its span is a little under 2r.
    if (span < minRadiusPx * 1.4 || span > maxRadiusPx * 2.2) continue;
    if (Math.abs(boxW - boxH) / span > MAX_BBOX_ASPECT_SKEW) continue;

    const holeRadius = span / 2;
    const points = [];
    let rayFailures = 0;
    for (let i = 0; i < RAY_COUNT; i += 1) {
      const angle = (i * 2 * Math.PI) / RAY_COUNT;
      const dx = Math.cos(angle); const dy = Math.sin(angle);
      const distance = measureRimAlongRay(page, region.cx, region.cy, dx, dy, {
        fromPx: holeRadius * 0.4,
        toPx: holeRadius + maxStrokePx + maxRadiusPx * 0.4,
        minStrokePx,
        maxStrokePx,
      });
      if (distance === null) { rayFailures += 1; continue; }
      points.push({ x: region.cx + dx * distance, y: region.cy + dy * distance });
    }
    // A closed rim answers every ray. A letter counter or a QR finder's white
    // ring does not, and is dropped here rather than fitted into nonsense.
    if (rayFailures > RAY_COUNT * 0.02 || points.length < RAY_COUNT * 0.9) continue;

    const fit = fitCircle(points);
    if (!fit) continue;
    const residualPt = (fit.residual * PT_PER_INCH) / dpi;
    if (residualPt > MAX_FIT_RESIDUAL_PT) continue;
    const rPt = (fit.r * PT_PER_INCH) / dpi;
    if (rPt < MIN_CANDIDATE_RADIUS_PT || rPt > MAX_CANDIDATE_RADIUS_PT) continue;

    found.push({
      xPt: pxToPt(fit.cx, dpi),
      yPt: pxToPt(fit.cy, dpi),
      rPt,
      residualPt,
      rays: points.length,
    });
  }
  found.sort((a, b) => (a.yPt - b.yPt) || (a.xPt - b.xPt));
  return found;
}

export default { toPageImage, detectCircles, findEnclosedRegions, pxToPt, ptToPxLength };
