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
