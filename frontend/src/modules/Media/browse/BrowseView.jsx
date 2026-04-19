import React from 'react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { resultToQueueInput } from '../search/resultToQueueInput.js';

function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter(Boolean);
}

export function BrowseView({ path, modifiers, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push, replace } = useNav();

  const segments = splitPath(path);

  if (loading) return <div data-testid="browse-view-loading">Loading…</div>;
  if (error) return <div data-testid="browse-view-error">{error.message}</div>;

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
        {segments.map((seg, idx) => {
          const pathUpToHere = segments.slice(0, idx + 1).join('/');
          const isLast = idx === segments.length - 1;
          return (
            <React.Fragment key={pathUpToHere}>
              <span className="browse-crumb-sep" aria-hidden="true">/</span>
              <button
                data-testid={`browse-crumb-${idx}`}
                className={`browse-crumb${isLast ? ' browse-crumb--current' : ''}`}
                onClick={() => { if (!isLast) replace('browse', { path: pathUpToHere, modifiers }); }}
                aria-current={isLast ? 'page' : undefined}
                disabled={isLast}
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
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
