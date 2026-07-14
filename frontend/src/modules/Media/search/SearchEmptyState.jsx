import React from 'react';

// When libraries FAILED (timed out / errored) and nothing came back, a
// definitive "No results" is a lie — the thing they searched for probably
// lives in the library that didn't answer (2026-07-14: plex timed out and
// "bluey" claimed no results). Say what actually happened and offer retry.
export function SearchEmptyState({ query, sourceErrors = [], onRetry }) {
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
