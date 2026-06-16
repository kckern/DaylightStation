// immichDimensions.mjs — orientation-corrected pixel dimensions for an Immich asset.
//
// Single source of truth for "how big is this photo, as displayed", shared by
// every Immich consumer (gallery ImmichAdapter, canvas, art screensaver) so they
// never disagree about a photo's aspect ratio.
//
// ORIENTATION CONTRACT: Immich's top-level `asset.width`/`asset.height` are
// ALREADY rotated to match how the image displays — the same orientation the
// `?size=preview` thumbnail is baked with. The `exifInfo.exifImageWidth/Height`
// are the RAW sensor dimensions, BEFORE the EXIF orientation tag is applied, so
// for a portrait shot tagged orientation 6/8 they read landscape. We therefore
// prefer the corrected top-level dims, and only fall back to the exif dims when
// the top-level pair is missing — swapping W/H when the orientation tag rotates
// the frame a quarter turn. (Reading raw exif dims as-is is the bug this
// prevents: orientation-6 portraits classified as landscape.)

// EXIF orientation values that rotate the frame 90°/270°, swapping W and H:
//   5 = transpose, 6 = 90° CW, 7 = transverse, 8 = 90° CCW.
const QUARTER_TURN = new Set([5, 6, 7, 8]);

function posInt(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Returns { width, height } as the photo displays, or { width: null, height: null }
// when neither the top-level nor the exif dimensions are usable.
export function immichDimensions(asset = {}) {
  const ex = asset.exifInfo || {};

  // Immich's top-level dims are orientation-corrected — trust them first.
  const topW = posInt(asset.width);
  const topH = posInt(asset.height);
  if (topW && topH) return { width: topW, height: topH };

  // Fallback: raw exif dims, swapped if the orientation tag turns the frame.
  const exW = posInt(ex.exifImageWidth);
  const exH = posInt(ex.exifImageHeight);
  if (exW && exH) {
    return QUARTER_TURN.has(Number(ex.orientation))
      ? { width: exH, height: exW }
      : { width: exW, height: exH };
  }

  return { width: null, height: null };
}

export default immichDimensions;
