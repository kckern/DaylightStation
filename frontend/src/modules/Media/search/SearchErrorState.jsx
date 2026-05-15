import React from 'react';

export function SearchErrorState({ error, onRetry }) {
  const message = error?.message ?? 'Search failed.';
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
