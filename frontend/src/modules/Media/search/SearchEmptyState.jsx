import React from 'react';

export function SearchEmptyState({ query }) {
  return (
    <div data-testid="search-empty" className="search-state search-state--empty">
      No results for &ldquo;{query}&rdquo;. Try a different word or change the scope.
    </div>
  );
}

export default SearchEmptyState;
