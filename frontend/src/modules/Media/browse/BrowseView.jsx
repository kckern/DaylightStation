// frontend/src/modules/Media/browse/BrowseView.jsx
// Hierarchical catalog browse over the List API. Containers drill (whole row
// navigates); playables open Detail with inline Play Now / Add. List-API
// containers are addressed by id, not accumulated path, so the breadcrumb is
// Home / [Back] / current label — never a raw id.
import React from 'react';
import { Skeleton, Alert, Text, Stack, Button } from '@mantine/core';
import { IconChevronRight, IconAlertCircle } from '@tabler/icons-react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../controller/useSessionController.js';
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

  const crumbLabel = label ?? (splitPath(path).join(' / ') || 'All');

  return (
    <Stack data-testid="browse-view" className="browse-view" gap="md">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <button
          data-testid="browse-crumb-home"
          className="browse-crumb browse-crumb--home"
          onClick={() => replace('home', {})}
        >
          Home
        </button>
        {depth > 1 && (
          <button data-testid="browse-crumb-back" className="browse-crumb" onClick={() => pop()}>
            ← Back
          </button>
        )}
        <span className="browse-crumb-sep" aria-hidden="true">/</span>
        <span className="browse-crumb browse-crumb--current" aria-current="page">{crumbLabel}</span>
      </nav>

      {loading && (
        <Stack gap="xs" data-testid="browse-view-loading">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={56} radius="sm" />)}
        </Stack>
      )}
      {error && (
        <Alert data-testid="browse-view-error" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {error.message}
        </Alert>
      )}
      {!loading && !error && items.length === 0 && (
        <Text c="dimmed" data-testid="browse-empty">Nothing here yet.</Text>
      )}

      {!loading && !error && (
        <ul className="browse-list">
          {items.map((row) => {
            const id = row.id ?? row.itemId;
            if (!id) return null;
            const isContainer = row.itemType === 'container';
            return (
              <li key={id} data-testid={`browse-row-${id}`} className="browse-row">
                {isContainer ? (
                  <button
                    data-testid={`browse-open-${id}`}
                    className="browse-row-open"
                    onClick={() => push('browse', {
                      path: String(id).replace(':', '/'),
                      label: row.title ?? id,
                      modifiers,
                    })}
                  >
                    <span className="browse-row-title">{row.title ?? id}</span>
                    <IconChevronRight size={18} aria-hidden />
                  </button>
                ) : (
                  <>
                    <button
                      data-testid={`browse-detail-${id}`}
                      className="browse-row-open"
                      onClick={() => push('detail', { contentId: id })}
                    >
                      <span className="browse-row-title">{row.title ?? id}</span>
                    </button>
                    <span className="browse-row-actions">
                      <button
                        data-testid={`result-play-now-${id}`}
                        className="result-action result-action--primary"
                        onClick={() => { const input = resultToQueueInput(row); if (input) queue.playNow(input, { clearRest: true }); }}
                      >
                        Play Now
                      </button>
                      <button
                        data-testid={`result-add-${id}`}
                        className="result-action"
                        onClick={() => { const input = resultToQueueInput(row); if (input) queue.add(input); }}
                      >
                        Add
                      </button>
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !error && items.length < total && (
        <Button data-testid="browse-load-more" variant="default" onClick={loadMore}>
          Load more ({total - items.length} remaining)
        </Button>
      )}
    </Stack>
  );
}

export default BrowseView;
