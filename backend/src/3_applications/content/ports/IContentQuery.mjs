/**
 * IContentQuery
 *
 * Provider-agnostic interface for searching and resolving household media content.
 * Implementation: ContentQueryService.
 *
 *   search(query: { text: string, source?: string, capability?: string, take?: number }):
 *     Promise<{ items: Array, total: number, sources: string[], warnings?: Array }>
 *
 *   resolve(source: string, localId: string, context?: object, overrides?: object):
 *     Promise<{ items: Array, strategy: object }>
 */
export function isContentQuery(obj) {
  return !!obj && typeof obj.search === 'function' && typeof obj.resolve === 'function';
}

export function assertContentQuery(obj) {
  if (!isContentQuery(obj)) throw new Error('Object does not implement IContentQuery');
}

export default { isContentQuery, assertContentQuery };
