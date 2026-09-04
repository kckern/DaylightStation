// Builds the URL for a food icon (Task 7.2's IconManifestStore route).
//
// The route takes NO user parameter — the icon vocabulary is household-wide
// (see health.mjs's note on that route). Never add one here.
//
// A slug is all the client ever holds. Filenames live in the manifest and
// nowhere else, so there is no path to build here and no extension to guess:
// the manifest owns which file a slug points at, and a rename is a manifest
// edit that this function never has to hear about.
//
// `'default'` is the capture pipeline's sentinel for "no icon was chosen". It
// resolves to a real file, but it is not a picture OF anything — a row showing
// it would be claiming a choice nobody made — so it is treated here as no
// icon at all and the caller falls back to the neutral dot.
export const NEUTRAL_ICON = 'default';

export function nutritionIconUrl(slug) {
  if (!slug || slug === NEUTRAL_ICON) return null;
  return `/api/v1/health/nutrition/icons/${encodeURIComponent(slug)}`;
}

export default nutritionIconUrl;
