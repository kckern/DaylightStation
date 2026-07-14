import React from 'react';

export function SearchErrorState({ error, onRetry }) {
  // Raw adapter/stream errors ("abs timeout after 8000ms") never render —
  // only our own friendly copy does.
  const message = error?.kind === 'connection'
    ? 'Lost connection to the search service.'
    : 'Search ran into a problem.';
  return (
    <div data-testid="search-error" className="search-state search-state--error">
      <span className="search-error-message">{message}</span>
      <button data-testid="search-retry" className="search-retry-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export default SearchErrorState;
