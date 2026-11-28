// frontend/src/modules/Media/browse/browsePath.js
// One rule for turning a content id into a List-API browse path, shared by
// every surface that opens a container: `plex:663508` → `plex/663508`, which
// BrowseView feeds to /api/v1/list/{path}. Only the FIRST colon splits —
// ids like `files:clips/x.mp4` keep the rest of their path intact.

export function contentIdToBrowsePath(contentId) {
  if (contentId == null) return '';
  return String(contentId).replace(':', '/');
}

/** The List-API path for a browse path and its modifiers. */
export function buildPath(path, { modifiers = {} }) {
  const clean = String(path).replace(/^\/|\/$/g, '');
  const segs = [clean];
  if (modifiers.playable) segs.push('playable');
  if (modifiers.shuffle) segs.push('shuffle');
  if (modifiers.recent_on_top) segs.push('recent_on_top');
  // Opt out of the router's season-as-one-tile wrapping: browsing a season
  // must list its episodes, not the season itself (defect 14).
  if (modifiers.expand) segs.push('expand');
  return `api/v1/list/${segs.join('/')}`;
}

/** The first-page URL a browse list asks for — what a hover prefetch warms. */
export function browseListUrl(path, { modifiers = {}, take = 50 } = {}) {
  return `${buildPath(path, { modifiers })}?take=${take}`;
}

export default contentIdToBrowsePath;
