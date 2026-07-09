/**
 * Resolve which items to show in the combobox dropdown.
 *
 * Decision rules:
 * - Not searching: show browseItems (siblings of current value).
 * - Searching with backend results: prefer backend (covers whole collection).
 * - Searching with no backend results: fall back to local filter over browseItems
 *   so users see instant response while backend is in flight.
 *
 * @param {object} args
 * @param {boolean} args.isActiveSearch - searchQuery has >= 2 chars and != current value
 * @param {string} args.searchQuery - raw search input
 * @param {string} args.sourcePrefix - current value's source (e.g. 'singalong', 'plex')
 * @param {Array}  args.browseItems - paginated siblings currently loaded
 * @param {Array}  args.searchResults - backend tier-1/tier-2 results
 * @returns {{items: Array, mode: 'browse'|'backend'|'local'}}
 */
export function resolveDisplayItems({
  isActiveSearch,
  searchQuery,
  sourcePrefix,
  browseItems,
  searchResults,
}) {
  if (!isActiveSearch) {
    return { items: browseItems, mode: 'browse' };
  }

  if (searchResults && searchResults.length > 0) {
    return { items: searchResults, mode: 'backend' };
  }

  const queryMatchesSource = sourcePrefix && searchQuery.startsWith(sourcePrefix + ':');
  if (!queryMatchesSource) {
    return { items: [], mode: 'backend' };
  }

  const localFilterQuery = searchQuery.split(':').slice(1).join(':').trim().toLowerCase();
  const filtered = browseItems.filter(item => {
    if (!localFilterQuery) return true;
    const num = item.value?.split(':')[1]?.trim();
    return (num && num.startsWith(localFilterQuery))
        || item.title?.toLowerCase().includes(localFilterQuery);
  });
  return { items: filtered, mode: 'local' };
}

// Content-id-like text (`plex:456724`, `hymn: 147`, `canvas:a/b.jpg`) is an
// intentional commit; exploratory search text is not. Space after the colon
// is tolerated because list YAML historically stores `hymn: 147`.
// Single source of truth — ContentSearchCombobox.jsx and ListsItemRow.jsx
// must import this, not re-declare it.
export const CONTENT_ID_LIKE = /^[\w-]+:\s?\S+/;

export function isContentIdLike(text) {
  return typeof text === 'string' && CONTENT_ID_LIKE.test(text);
}

// EmptyItemRow auto-add gate: only auto-persist values that came from a
// dropdown selection or a pasted content id. Freeform text must be added
// explicitly (Enter on the row). Root cause of the 2026-03-01 tvapp.yml
// junk-entries bug: blur-commit → setInput → auto-add POST of raw text.
export function shouldAutoAdd(input) {
  return isContentIdLike(input);
}
