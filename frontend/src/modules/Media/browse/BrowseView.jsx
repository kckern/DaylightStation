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
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, Stack } from '@mantine/core';
import {
  IconChevronRight,
  IconAlertCircle,
  IconPlayerPlay,
  IconArrowsShuffle,
  IconPlus,
} from '@tabler/icons-react';
import { useListBrowse } from './useListBrowse.js';
import { useNav } from '../shell/NavProvider.jsx';
import { useContentDispatch } from '../search/useContentDispatch.js';
import { isContainer } from '../../Content/combobox/comboboxMachine.js';
import { DestinationLine } from '../cast/DestinationLine.jsx';
import getLogger from '../../../lib/logging/Logger.js';
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { ResultRow } from '../../Content/combobox/ResultRow.jsx';
import { ItemDestinationPicker } from '../actions/ItemDestinationPicker.jsx';
import { displayTitle, resultSubtitle } from '../search/resultPresentation.js';

function splitPath(path) {
  if (!path) return [];
  return String(path).split('/').filter(Boolean);
}

export function naturalBrowseOrder(items) {
  const numeric = (item, names) => {
    for (const name of names) {
      const value = item?.[name] ?? item?.metadata?.[name];
      if (Number.isFinite(Number(value))) return Number(value);
    }
    return null;
  };
  return (items ?? []).map((item, arrival) => ({ item, arrival })).sort((a, b) => {
    const aSeason = numeric(a.item, ['seasonNumber', 'parentIndex', 'season']) ?? 0;
    const bSeason = numeric(b.item, ['seasonNumber', 'parentIndex', 'season']) ?? 0;
    if (aSeason !== bSeason) return aSeason - bSeason;
    const aPart = numeric(a.item, ['episodeNumber', 'trackNumber', 'index', 'itemIndex', 'number']);
    const bPart = numeric(b.item, ['episodeNumber', 'trackNumber', 'index', 'itemIndex', 'number']);
    if (aPart != null && bPart != null && aPart !== bPart) return aPart - bPart;
    return a.arrival - b.arrival;
  }).map(({ item }) => item);
}

function findScrollHost(node) {
  let current = node?.parentElement ?? null;
  while (current) {
    if (current.matches?.('.media-canvas, [data-media-scroll-host], [data-testid="scroll-host"]')) return current;
    current = current.parentElement;
  }
  return null;
}

export function BrowseView({
  path, label, modifiers, containerItem = null, take = 50,
  breadcrumbs = [], scrollTop = 0, focusedId = null,
}) {
  const { items: rawItems, total, loading, loadingMore = false, error, loadMore } = useListBrowse(path, { modifiers, take });
  const items = useMemo(() => naturalBrowseOrder(rawItems), [rawItems]);
  const [oneShot, setOneShot] = useState(null);
  const { push, replace, pop, depth, backDestination } = useNav();
  const { dispatchLeafVerb, playContainerAsQueue, addContainerToQueue } = useContentDispatch();
  const log = useMemo(() => getLogger().child({ component: 'browse-view' }), []);
  const rootRef = useRef(null);
  const sentinelRef = useRef(null);
  const restoredEntryRef = useRef(null);

  const crumbLabel = label ?? (splitPath(path).join(' / ') || 'All');

  // Only a browse view opened FOR a specific container gets the dispatch
  // header — reuses the same isContainer predicate the tap grammar itself
  // is built on (comboboxMachine.js), not a second definition of "container".
  const isContainerView = !!containerItem && isContainer(containerItem);
  const containerId = containerItem?.id ?? null;

  useLayoutEffect(() => {
    if (loading || !rootRef.current) return;
    const entryKey = `${path ?? ''}\u001f${scrollTop ?? 0}\u001f${focusedId ?? ''}`;
    if (restoredEntryRef.current === entryKey) return;
    const focusTarget = focusedId
      ? [...rootRef.current.querySelectorAll('[data-browse-focus-id]')]
          .find((node) => node.dataset.browseFocusId === String(focusedId))
      : null;
    // NavProvider can change the path one render before useListBrowse clears
    // the preceding path's rows. Do not spend this history entry's one-shot
    // restoration against that stale DOM; the real row arrival below will
    // change items.length and retry the layout restoration.
    if (focusedId && !focusTarget) return;
    restoredEntryRef.current = entryKey;
    const host = findScrollHost(rootRef.current);
    if (host) host.scrollTop = scrollTop || 0;
    focusTarget?.focus({ preventScroll: true });
  }, [focusedId, items, loading, path, scrollTop]);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading || loadingMore || items.length >= total || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: findScrollHost(rootRef.current), rootMargin: '160px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, loadMore, loading, loadingMore, total]);

  const openContainer = (row, id) => {
    const host = findScrollHost(rootRef.current);
    const currentPatch = { path, scrollTop: host?.scrollTop ?? 0, focusedId: id };
    push('browse', {
      path: String(id).replace(':', '/'),
      label: row.title ?? id,
      modifiers,
      containerItem: { ...row, id },
      breadcrumbs: [...breadcrumbs, { path, label: crumbLabel, containerItem }],
    }, { currentPatch });
  };

  const runHeaderVerb = (action, fn) => {
    if (!containerId) return;
    log.info('dispatch_header_action', { action, contentId: containerId });
    const route = fn(containerId, containerItem);
    log.info('dispatch_header_result', { action, contentId: containerId, route });
  };

  return (
    <Stack ref={rootRef} data-testid="browse-view" className="browse-view" gap="md">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <button
          data-testid="browse-crumb-home"
          className="browse-crumb browse-crumb--home"
          onClick={() => replace('home', {})}
        >
          Home
        </button>
        {depth > 1 && breadcrumbs.length === 0 && (
          <button data-testid="browse-crumb-back" className="browse-crumb" onClick={() => pop()}>
            ← {backDestination ?? 'Home'}
          </button>
        )}
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={`${crumb.path}-${index}`}>
            <span className="browse-crumb-sep" aria-hidden="true">/</span>
            <button
              type="button"
              className="browse-crumb"
              data-testid={`browse-crumb-parent-${index}`}
              onClick={() => replace('browse', {
                ...crumb,
                breadcrumbs: breadcrumbs.slice(0, index),
              })}
            >
              {crumb.label}
            </button>
          </React.Fragment>
        ))}
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
                <ResultRow
                  item={{ ...row, id }}
                  title={displayTitle(row)}
                  subtitle={resultSubtitle(row)}
                  thumbnail={row.thumbnail}
                  testId={rowIsContainer ? `browse-open-${id}` : `result-play-now-${id}`}
                  focusId={id}
                  onTap={() => rowIsContainer ? openContainer(row, id) : dispatchLeafVerb('playNow', id, row)}
                  onPlayAll={rowIsContainer ? () => playContainerAsQueue(id, row) : null}
                  onDetails={rowIsContainer ? null : () => push('detail', { contentId: id })}
                  detailsTestId={rowIsContainer ? null : `browse-detail-${id}`}
                  onAction={action => {
                  if (['playOn', 'addOn'].includes(action.kind)) setOneShot(action);
                  else if (action.kind === 'details') push('detail', { contentId: id });
                  else dispatchLeafVerb(action.kind, id, row);
                  }}
                />
                {rowIsContainer && <IconChevronRight size={18} aria-hidden />}
              </li>
            );
          })}
        </ul>
      )}
      {!loading && !error && items.length < total && (
        <div ref={sentinelRef} data-testid="browse-page-sentinel" role="status" aria-label="Loading more titles" style={{ minHeight: 1 }}>
          {loadingMore ? 'Loading more…' : ''}
        </div>
      )}
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
    </Stack>
  );
}

export default BrowseView;
