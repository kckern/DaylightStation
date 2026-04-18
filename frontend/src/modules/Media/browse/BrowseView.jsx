import React from 'react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

export function BrowseView({ path, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push } = useNav();

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

  return (
    <div data-testid="browse-view" className="browse-view">
      <h2>{path}</h2>
      <ul>
        {items.map((row) => {
          const id = row.id ?? row.itemId;
          if (!id) return null;
          const isContainer = row.itemType === 'container';
          return (
            <li key={id} data-testid={`browse-row-${id}`}>
              {isContainer ? (
                <button
                  data-testid={`browse-open-${id}`}
                  onClick={() => push('browse', { path: `${path}/${id}` })}
                >
                  {row.title ?? id} →
                </button>
              ) : (
                <>
                  <button
                    data-testid={`browse-detail-${id}`}
                    onClick={() => push('detail', { contentId: id })}
                  >
                    {row.title ?? id}
                  </button>
                  <button
                    data-testid={`result-play-now-${id}`}
                    onClick={() => { const input = resultToQueueInput(row); if (input) queue.playNow(input, { clearRest: true }); }}
                  >
                    Play Now
                  </button>
                  <button
                    data-testid={`result-add-${id}`}
                    onClick={() => { const input = resultToQueueInput(row); if (input) queue.add(input); }}
                  >
                    Add
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {items.length < total && (
        <button data-testid="browse-load-more" onClick={loadMore}>Load more ({total - items.length} remaining)</button>
      )}
    </div>
  );
}

export default BrowseView;
