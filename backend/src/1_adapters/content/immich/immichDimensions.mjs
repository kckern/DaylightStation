// Immich anti-corruption mapping for orientation-corrected asset dimensions.
const QUARTER_TURN = new Set([5, 6, 7, 8]);

function posInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function immichDimensions(asset = {}) {
  const exif = asset.exifInfo || {};
  const width = posInt(asset.width);
  const height = posInt(asset.height);
  if (width && height) return { width, height };

  const exifWidth = posInt(exif.exifImageWidth);
  const exifHeight = posInt(exif.exifImageHeight);
  if (exifWidth && exifHeight) {
    return QUARTER_TURN.has(Number(exif.orientation))
      ? { width: exifHeight, height: exifWidth }
      : { width: exifWidth, height: exifHeight };
  }
  return { width: null, height: null };
}

export default immichDimensions;
