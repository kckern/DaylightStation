import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from './resultToQueueInput.js';

export function SearchResults({ results = [], pending = [], isSearching = false }) {
  const { queue } = useSessionController('local');
  const { push } = useNav();

  if (isSearching && results.length === 0) {
    return <div data-testid="media-search-results" className="media-search-results">Searching…</div>;
  }
  if (!results.length) return null;

  const handle = (row, action) => (e) => {
    e.stopPropagation();
    const input = resultToQueueInput(row);
    if (!input) return;
    if (action === 'playNow') queue.playNow(input, { clearRest: true });
    else if (action === 'add') queue.add(input);
    else if (action === 'playNext') queue.playNext(input);
    else if (action === 'addUpNext') queue.addUpNext(input);
  };

  return (
    <ul data-testid="media-search-results" className="media-search-results">
      {results.map((row) => {
        const id = row.id ?? row.itemId;
        if (!id) return null;
        return (
          <li key={id} data-testid={`result-row-${id}`}>
            <button
              data-testid={`result-open-${id}`}
              onClick={() => push('detail', { contentId: id })}
              className="media-result-title"
            >
              {row.title ?? id}
            </button>
            <span className="media-result-actions">
              <button data-testid={`result-play-now-${id}`} onClick={handle(row, 'playNow')}>Play Now</button>
              <button data-testid={`result-play-next-${id}`} onClick={handle(row, 'playNext')}>Play Next</button>
              <button data-testid={`result-upnext-${id}`} onClick={handle(row, 'addUpNext')}>Up Next</button>
              <button data-testid={`result-add-${id}`} onClick={handle(row, 'add')}>Add</button>
            </span>
          </li>
        );
      })}
      {pending.length > 0 && <li data-testid="media-search-pending">Loading {pending.join(', ')}…</li>}
    </ul>
  );
}

export default SearchResults;
