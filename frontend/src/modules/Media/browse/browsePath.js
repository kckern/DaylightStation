// frontend/src/modules/Media/browse/browsePath.js
// One rule for turning a content id into a List-API browse path, shared by
// every surface that opens a container: `plex:663508` → `plex/663508`, which
// BrowseView feeds to /api/v1/list/{path}. Only the FIRST colon splits —
// ids like `files:clips/x.mp4` keep the rest of their path intact.

export function contentIdToBrowsePath(contentId) {
  if (contentId == null) return '';
  return String(contentId).replace(':', '/');
}

export default contentIdToBrowsePath;
