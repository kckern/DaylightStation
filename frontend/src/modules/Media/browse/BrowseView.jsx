import React from 'react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter(Boolean);
}

export function BrowseView({ path, label, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push, replace, pop, depth } = useNav();

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

  // List-API containers are addressed by id, not by accumulated path, so path
  // segments past the first drill are meaningless. Render Home / [Back] / label.
  const crumbLabel = label ?? splitPath(path).join(' / ');

  return (
    <div data-testid="browse-view" className="browse-view">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <button
          data-testid="browse-crumb-home"
          className="browse-crumb browse-crumb--home"
          onClick={() => replace('home', {})}
        >
          Home
        </button>
        {depth > 1 && (
          <button data-testid="browse-crumb-back" className="browse-crumb" onClick={() => pop()}>← Back</button>
        )}
        <span className="browse-crumb-sep" aria-hidden="true">/</span>
        <span className="browse-crumb browse-crumb--current" aria-current="page">{crumbLabel}</span>
      </nav>
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
                  onClick={() => push('browse', {
                    path: String(id).replace(':', '/'),
                    label: row.title ?? id,
                    modifiers,
                  })}
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
