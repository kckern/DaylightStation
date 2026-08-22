import React from 'react';

// When libraries FAILED (timed out / errored) and nothing came back, a
// definitive "No results" is a lie — the thing they searched for probably
// lives in the library that didn't answer (2026-07-14: plex timed out and
// "bluey" claimed no results). Say what actually happened and offer retry.
//
// D5 (2026-08-21 incident): a search silently SCOPED to a narrow library
// (e.g. Music›Ambient) settling empty looked identical to "this doesn't
// exist anywhere" — the combobox hook (useContentCombobox, Task 11) now
// auto-widens a clean empty settle to the catalog-wide scope and reports
// `fellBackToAll`. When the caller passes that flag through, name what
// happened instead of leaving the scope silently swapped: if the wider
// search found something, say where it looked and how many turned up; if
// even the wider search is empty, fall through to the plain empty copy
// below (no "everywhere" claim to make when nothing was found anywhere).
export function SearchEmptyState({ query, sourceErrors = [], onRetry, fellBackToAll = false, scopeLabel = null, resultCount = 0 }) {
  if (fellBackToAll && resultCount > 0) {
    return (
      <div data-testid="search-empty" className="search-state search-state--fallback">
        Nothing in {scopeLabel || 'this scope'} — showing {resultCount} result{resultCount === 1 ? '' : 's'} from everywhere.
      </div>
    );
  }
  if (sourceErrors.length > 0) {
    return (
      <div data-testid="search-empty" className="search-state search-state--empty">
        <span>
          Some libraries didn&rsquo;t respond, so &ldquo;{query}&rdquo; may have been missed.
        </span>
        {typeof onRetry === 'function' && (
          <button
            type="button"
            data-testid="search-empty-retry"
            className="search-empty-retry"
            onClick={onRetry}
          >
            Search again
          </button>
        )}
      </div>
    );
  }
  return (
    <div data-testid="search-empty" className="search-state search-state--empty">
      No results for &ldquo;{query}&rdquo;. Try a different word or change the scope.
    </div>
  );
}

export default SearchEmptyState;
