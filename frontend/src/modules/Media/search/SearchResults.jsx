import React from 'react';
import { ResultRow } from './ResultRow.jsx';

export function SearchResults({ results = [], pending = [], onAction }) {
  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        return <ResultRow key={id} row={row} onAction={onAction} />;
      })}
      {pending.length > 0 && (
        <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>
      )}
    </ul>
  );
}

export default SearchResults;
