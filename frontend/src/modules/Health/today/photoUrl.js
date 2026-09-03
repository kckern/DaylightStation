// Builds the URL for a stored capture photo (Task 2.3's PhotoStore route).
//
// The route takes NO user parameter — the backend always resolves to the
// household default (see health.mjs's security note on that route). Never
// add one here.
//
// `thumb: true` requests the 320px thumbnail variant (`?size=thumb`); the
// server falls back to the original if no thumbnail exists. Omit it for
// the full-size photo (shown larger inside the edit sheet).
export function nutritionPhotoUrl(photoRef, { thumb = false } = {}) {
  if (!photoRef) return null;
  const qs = thumb ? '?size=thumb' : '';
  return `/api/v1/health/nutrition/photos/${encodeURIComponent(photoRef)}${qs}`;
}

export default nutritionPhotoUrl;
