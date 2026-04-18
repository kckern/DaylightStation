import React from 'react';

export function SearchResults({ results = [] }) {
  return (
    <ul data-testid="media-search-results">
      {results.map((r) => <li key={r.id ?? r.itemId}>{r.title}</li>)}
    </ul>
  );
}

export default SearchResults;
