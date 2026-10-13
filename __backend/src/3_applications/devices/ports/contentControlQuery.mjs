/** Legacy content-query contract shared by the use case and its output adapter. */
export const CONTENT_ID_KEYS = Object.freeze([
  'queue',
  'play',
  'play-next',
  'plex',
  'hymn',
  'primary',
  'scripture',
  'contentId',
]);

export function resolveContentId(query) {
  if (!query || typeof query !== 'object') return null;
  for (const key of CONTENT_ID_KEYS) {
    const value = query[key];
    if (typeof value === 'string' && value.length > 0) {
      return { contentId: value, resolvedKey: key };
    }
  }
  return null;
}
