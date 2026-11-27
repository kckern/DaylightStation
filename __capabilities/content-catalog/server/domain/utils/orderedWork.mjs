/**
 * Ordered works: a container that is meant to be heard in its own order.
 *
 * A book (or a talk series or course heard as audio) plays part 1, part 2,
 * part 3. The queue's watch-aware order (unwatched first, then watched by
 * recency) is right for a TV season or a music list and wrong for a book: it
 * plays heard parts again after the last one and moves a part with a play
 * count out of its place. For an ordered work the queue keeps the container's
 * order and names where to start instead (see QueueService.resolveQueue).
 *
 * What a library holds comes from the household media config,
 * `play_on_demand.library_kinds`: a library, named by its title or its Plex
 * section id, is `books`, `talks` (talks and courses) or `music`; a library not
 * named is music. Books and talks are ordered works.
 *
 * @module content-catalog/domain/utils/orderedWork
 */

export const ORDERED_LIBRARY_KINDS = new Set(['books', 'talks']);
const KNOWN_KINDS = new Set(['music', 'books', 'talks']);

/**
 * `library_kinds` config → Map of lower-cased library key (title or section id) → kind.
 * Unknown kinds and malformed config are ignored.
 * @param {Object|null|undefined} config
 * @returns {Map<string,string>}
 */
export function libraryKindMap(config) {
  const kinds = new Map();
  if (!config || typeof config !== 'object' || Array.isArray(config)) return kinds;
  for (const [key, value] of Object.entries(config)) {
    const kind = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (KNOWN_KINDS.has(kind)) kinds.set(String(key).trim().toLowerCase(), kind);
  }
  return kinds;
}

/**
 * The kind of the library an item comes from, or null when the item names no
 * library. A named library that the config does not list is music.
 * @param {{metadata?: {librarySectionID?: *, librarySectionTitle?: string}}} item
 * @param {Map<string,string>} kinds
 * @returns {string|null}
 */
export function libraryKindOf(item, kinds) {
  const meta = item?.metadata ?? {};
  const sectionId = meta.librarySectionID != null && meta.librarySectionID !== '' ? String(meta.librarySectionID) : null;
  const title = typeof meta.librarySectionTitle === 'string' && meta.librarySectionTitle.trim()
    ? meta.librarySectionTitle.trim().toLowerCase() : null;
  if (!sectionId && !title) return null;
  return (sectionId && kinds.get(sectionId.toLowerCase())) || (title && kinds.get(title)) || 'music';
}

/**
 * True when a resolved container is an ordered work: at least one item comes
 * from a books or talks library and every item that names a library does. A
 * playlist mixing a book with songs is not one (it keeps the music order).
 * @param {Array<object>} items
 * @param {Map<string,string>} kinds
 * @returns {boolean}
 */
export function isOrderedWork(items, kinds) {
  if (!Array.isArray(items) || items.length === 0 || !kinds?.size) return false;
  let ordered = 0;
  for (const item of items) {
    const kind = libraryKindOf(item, kinds);
    if (kind == null) continue;
    if (!ORDERED_LIBRARY_KINDS.has(kind)) return false;
    ordered += 1;
  }
  return ordered > 0;
}

export default { libraryKindMap, libraryKindOf, isOrderedWork, ORDERED_LIBRARY_KINDS };
