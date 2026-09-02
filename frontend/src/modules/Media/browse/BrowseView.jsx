// frontend/src/modules/Media/browse/BrowseView.jsx
// Hierarchical catalog browse over the List API. Containers drill (whole row
// navigates); playables open Detail with inline Play Now / Add. List-API
// containers are addressed by id, not accumulated path, so the breadcrumb is
// Home / [Back] / current label — never a raw id.
//
// Task 15 (spec D6 addendum): a container tap ALWAYS browses (Task 14) —
// that decision only pays off if browsing in costs the user nothing over
// playing on tap. `containerItem` (forwarded by whichever caller opened this
// specific container — useContentDispatch's dispatch(), or this component's
// own nested-drill handler below) carries the tapped item along, so a
// container-level browse view opens with a Play / Shuffle / Queue header
// (icons, not unicode glyphs — see Task 16), all three acting on the WHOLE
// container against the visible destination (DestinationLine). Root/category
// browse levels (Home's source/mediaType cards, the plain "Browse" nav item)
// never pass a containerItem, so the header stays absent there — nothing
// single to play.
import React, { useMemo } from 'react';
import { Alert, Text, Stack, Button } from '@mantine/core';
import {
  IconChevronRight,
  IconAlertCircle,
  IconPlayerPlay,
  IconArrowsShuffle,
  IconPlus,
} from '@tabler/icons-react';
import { useListBrowse } from './useListBrowse.js';
import { useSessionController } from '../controller/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { useContentDispatch } from '../search/useContentDispatch.js';
import { resultToQueueInput } from '../search/resultToQueueInput.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { DestinationLine } from '../cast/DestinationLine.jsx';
import getLogger from '../../../lib/logging/Logger.js';
import Skeleton from '@/lib/ui/Skeleton.jsx';

function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter(Boolean);
}

export function BrowseView({ path, label, modifiers, containerItem = null, take = 50 }) {
  const { items, total, loading, error, loadMore } = useListBrowse(path, { modifiers, take });
  const { queue } = useSessionController('local');
  const { push, replace, pop, depth } = useNav();
  const { playContainerAsQueue, addContainerToQueue } = useContentDispatch();
  const log = useMemo(() => getLogger().child({ component: 'browse-view' }), []);

  const crumbLabel = label ?? (splitPath(path).join(' / ') || 'All');

  // Only a browse view opened FOR a specific container gets the dispatch
  // header — reuses the same isContainer predicate the tap grammar itself
  // is built on (comboboxMachine.js), not a second definition of "container".
  const isContainerView = !!containerItem && isContainer(containerItem);
  const containerId = containerItem?.id ?? null;

  const runHeaderVerb = (action, fn) => {
    if (!containerId) return;
    log.info('dispatch_header_action', { action, contentId: containerId });
    const route = fn(containerId, containerItem);
    log.info('dispatch_header_result', { action, contentId: containerId, route });
  };

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

      {isContainerView && (
        <div className="browse-dispatch-header" data-testid="browse-dispatch-header">
          <div className="browse-dispatch-actions">
            <button
              type="button"
              data-testid="browse-dispatch-play"
              className="browse-dispatch-btn browse-dispatch-btn--primary"
              onClick={() => runHeaderVerb('play', playContainerAsQueue)}
            >
              <IconPlayerPlay size={16} aria-hidden="true" /> Play
            </button>
            <button
              type="button"
              data-testid="browse-dispatch-shuffle"
              className="browse-dispatch-btn"
              onClick={() => runHeaderVerb('shuffle', (id, item) => playContainerAsQueue(id, item, { shuffle: true }))}
            >
              <IconArrowsShuffle size={16} aria-hidden="true" /> Shuffle
            </button>
            <button
              type="button"
              data-testid="browse-dispatch-queue"
              className="browse-dispatch-btn"
              onClick={() => runHeaderVerb('queue', addContainerToQueue)}
            >
              <IconPlus size={16} aria-hidden="true" /> Queue
            </button>
          </div>
          <DestinationLine surface="browse-header" />
        </div>
      )}

      {loading && (
        <Stack gap="xs" data-testid="browse-view-loading">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={56} radius="sm" />)}
        </Stack>
      )}
      {error && (
        <Alert data-testid="browse-view-error" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          Couldn&apos;t load this section. Check the connection and try again.
          <details className="error-detail">
            <summary>Technical details</summary>
            {error.message}
          </details>
        </Alert>
      )}
      {!loading && !error && items.length === 0 && (
        <Text c="dimmed" data-testid="browse-empty" className="browse-empty">Nothing here yet.</Text>
      )}

      {!loading && !error && (
        <ul className="browse-list">
          {items.map((row) => {
            const id = row.id ?? row.itemId;
            if (!id) return null;
            const rowIsContainer = row.itemType === 'container';
            return (
              <li key={id} data-testid={`browse-row-${id}`} className="browse-row">
                {rowIsContainer ? (
                  <button
                    data-testid={`browse-open-${id}`}
                    className="browse-row-open"
                    onClick={() => push('browse', {
                      path: String(id).replace(':', '/'),
                      label: row.title ?? id,
                      modifiers,
                      containerItem: { ...row, id },
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
