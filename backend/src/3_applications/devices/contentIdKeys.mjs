/**
 * Shared priority order for resolving a content reference from a legacy query.
 *
 * The first key that exists (as a non-empty string) in the query becomes the
 * CommandEnvelope's `params.contentId`. Used by both `WebSocketContentAdapter`
 * and `WakeAndLoadService` to ensure every WS-content-delivery path resolves
 * the same contentId for the same query shape.
 */
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

/**
 * Resolve a contentId from a query object using CONTENT_ID_KEYS priority.
 * Returns `{ contentId, resolvedKey }` on success, `null` if nothing resolves.
 */
export function resolveContentId(query) {
  if (!query || typeof query !== 'object') return null;
  for (const key of CONTENT_ID_KEYS) {
    const v = query[key];
    if (typeof v === 'string' && v.length > 0) {
      return { contentId: v, resolvedKey: key };
    }
  }
  return null;
}
