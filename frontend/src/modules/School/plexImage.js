/**
 * plexImage — ask Plex for artwork AT THE SIZE WE DRAW IT.
 *
 * The API hands us the ORIGINAL poster, proxied but unresized
 * (`/api/v1/proxy/plex/library/metadata/<key>/thumb/<ts>`). Originals vary
 * wildly — measured on this library: 640x640, 900x1350, 1024x1024, and one
 * 1336x1920 at 3.1 MB — while a grid tile draws about 236px wide. So the
 * browser was downscaling by anywhere from 2.7x to 5.7x, per image, with its
 * cheap bilinear filter. That is exactly the "some covers smooth, some
 * abysmal" split: quality tracked each poster's happenstance resolution, not
 * anything about our layout. Hand Plex the box instead and its resampler
 * (proper, done once, cached server-side) returns a near-1:1 image the browser
 * barely has to touch — uniformly smooth, and 57 KB instead of 3.1 MB.
 *
 * Widths snap to a ladder so a fluid grid doesn't spawn a fresh transcode per
 * pixel of column width — a handful of sizes stay cache-warm on the Plex side.
 *
 * The same `/photo/:/transcode` passthrough the Fitness player already uses
 * (modules/Fitness/player/FitnessPlayer.jsx) — `minSize=1` matches our
 * `object-fit: cover` (fill the box, crop the overflow).
 */
const PLEX_PROXY = '/api/v1/proxy/plex';
const WIDTH_STEPS = [160, 240, 320, 480, 640, 960];

/**
 * @param {string|null|undefined} src - poster/thumb as the API sent it
 * @param {number} boxWidth - CSS px width we render it at
 * @param {number} boxHeight - CSS px height we render it at
 * @returns {string|null|undefined} a sized URL, or `src` untouched when it is
 *   not a proxied Plex image (a non-Plex source, or one already sized)
 */
export function sizedPlexImage(src, boxWidth, boxHeight) {
  if (!src || typeof src !== 'string') return src;
  if (!src.startsWith(`${PLEX_PROXY}/`) || src.includes('/photo/:/transcode')) return src;
  if (!(boxWidth > 0) || !(boxHeight > 0)) return src;

  // Retina panels need the extra pixels; cap at 2 so a 3x phone doesn't ask
  // for a poster nobody can see the difference in.
  const dpr = Math.min(2, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
  const want = boxWidth * dpr;
  const width = WIDTH_STEPS.find((step) => step >= want) ?? WIDTH_STEPS[WIDTH_STEPS.length - 1];
  const height = Math.round(width * (boxHeight / boxWidth));

  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    minSize: '1',
    upscale: '1',
    url: src.slice(PLEX_PROXY.length),
  });
  return `${PLEX_PROXY}/photo/:/transcode?${params.toString()}`;
}

/**
 * The box each artwork shape is actually drawn in, in CSS px (School.scss).
 * Named here rather than inline at each call site so the request size and the
 * layout stay in one place — if a grid column changes, this is what to update.
 */
export const ART_BOX = {
  gridPoster: [240, 360],   // .school-materials__grid tile, aspect-ratio 2/3
  gridSquare: [240, 240],   // .school-materials__tile--square (a collection)
  detailPoster: [230, 345], // .school-material-detail__poster (max-width 230)
  unitThumb: [240, 135],    // .school-material-detail__thumb, aspect-ratio 16/9
};

export default sizedPlexImage;
