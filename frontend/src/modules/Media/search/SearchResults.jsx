import React from 'react';
import { ResultRow } from './ResultRow.jsx';
import { sourceLabelList } from './sourceLabels.js';
import './Search.scss';

// Detail shown while stragglers stream in: friendly labels only, and only
// when the remainder is short enough to read at a glance.
const MAX_PENDING_LABELS = 3;

export function SearchResults({ results = [], pending = [], onAction }) {
  const pendingLabels = sourceLabelList(pending);
  const pendingDetail = pendingLabels.length > 0 && pendingLabels.length <= MAX_PENDING_LABELS
    ? ` — ${pendingLabels.join(', ')}` : '';
  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        return <ResultRow key={id} row={row} onAction={onAction} />;
      })}
      {pending.length > 0 && (
        <li data-testid="media-search-pending" className="search-still-searching" aria-live="polite">
          <span className="search-still-searching-spinner" aria-hidden="true" />
          Still searching{pendingDetail}…
        </li>
      )}
    </ul>
  );
}

export default SearchResults;
