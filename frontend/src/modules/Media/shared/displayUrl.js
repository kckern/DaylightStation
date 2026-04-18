export function displayUrl(contentId) {
  if (typeof contentId !== 'string' || !contentId.includes(':')) return null;
  const idx = contentId.indexOf(':');
  const source = contentId.slice(0, idx);
  const localId = contentId.slice(idx + 1);
  if (!source || !localId) return null;
  return `/api/v1/display/${source}/${localId}`;
}

export default displayUrl;
