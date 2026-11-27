// frontend/src/modules/Media/browse/BrowseView.jsx
// Hierarchical catalog browse over the List API. Containers drill (whole row
// navigates); a playable row OPENS its detail page (a look) and plays only
// from its own trailing ▶, which names where it plays ("▶ Office Screen" —
// habits/playDestination.js). List-API
// containers are addressed by id, not accumulated path, so the breadcrumb is
// Home / [Back] / current label — never a raw id.
//
// Browse headers (owner report 2026-11-27): a page for a person, show,
// season, album or collection opens with BrowseHeader — picture, parent chip,
// facts, the summary, and the info view's own row of play controls. The page
// reads its own info (`GET /api/v1/info`), so a page opened by its address
// gets the same header and a breadcrumb of the content's parents; the
// breadcrumb never names the app area the person came from, and never shows
// a raw id. A show with one season lists that season's episodes at once.
// Container rows (and the parent chip) are prefetched on hover or focus.
//
// Task 15 (spec D6 addendum): a container tap ALWAYS browses (Task 14) —
// that decision only pays off if browsing in costs the user nothing over
// playing on tap. `containerItem` (forwarded by whichever caller opened this
// specific container — useContentDispatch's dispatch(), or this component's
// own nested-drill handler below) carries the tapped item along, so a
// container-level browse view opens with a Play / Shuffle / Queue header
// (icons, not unicode glyphs — see Task 16), all three acting on the WHOLE
// container; Play names where it plays, like every other ▶. Root/category
// browse levels (Home's source/mediaType cards, the plain "Browse" nav item)
// never pass a containerItem, so the header stays absent there — nothing
// single to play.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, Stack, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { useListBrowse } from "./useListBrowse.js";
import { useNav } from "../shell/NavProvider.jsx";
import { useContentDispatch } from "../search/useContentDispatch.js";
import { isContainer } from "../../../../../__capabilities/content-catalog/browser/combobox-state.mjs";
import { LoadErrorLine } from "../shared/LoadErrorLine.jsx";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";
import Skeleton from '@/lib/ui/Skeleton.jsx';
import { Button } from '@/lib/ui/Button.jsx';
import { UiIcon } from '@/lib/ui/UiIcon.jsx';
import { useRetryRegion } from '@/lib/ui/useRetryRegion.js';
import { StateMessage } from '@/lib/ui/states.jsx';
import { ResultRow } from "../../../../../__capabilities/content-catalog/browser/result-row.mjs";
import { useRowExtras } from "../search/useRowLabels.js";
import { ItemDestinationPicker } from "../actions/ItemDestinationPicker.jsx";
import { sourceIconFor, dedupeSourceRows } from "./sourceIcons.jsx";
import { sourceRootPresentation } from "../search/resultPresentation.js";
import { useDismissLayer } from "@/lib/ui/dismiss/useDismissLayer.js";
import { useHouseholdResultActions } from "../household/useHouseholdResultActions.js";
import { usePlayDestination } from "../habits/usePlayDestination.js";
import { useContentInfo } from "./useContentInfo.js";
import { BrowseHeader } from "./BrowseHeader.jsx";
import { prefetchBrowse } from "./prefetchBrowse.js";
import { ancestorsOf, contentIdFromPath, pathFor, sectionsFor, soleSeasonOf, unwatchedCount, watchState, watchedSubtitle } from "./browseHeaderModel.js";
import { TopMoreList } from '@/lib/ui/TopMore.jsx';

// A person page shows this many of each kind before "More (k)".
const SECTION_SHOWN = 10;
import { sourceLabel } from "../../../../../__capabilities/content-catalog/browser/source-labels.mjs";
import mediaLog from "../logging/mediaLog.js";

const LISTABLE_TYPES = new Set(['season', 'collection']);
/** A page worth a header: a container by the shared predicate, or a season/collection. */
function headerWorthy(item) {
  if (!item) return false;
  const type = item.type ?? item.metadata?.type;
  return isContainer(item) || LISTABLE_TYPES.has(type);
}

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
  breadcrumbs = [], scrollTop = 0, focusedId = null, loadedCount = 0,
}) {
  // Only a container id (source/localId) can be a season/playlist the router
  // would wrap as one tile; the root and a source's own root list as-is.
  const pageId = contentIdFromPath(path);
  // The page's own info: the header's words, and the breadcrumb of a page
  // opened by its address. Read ahead by prefetchBrowse on hover.
  const { info: pageInfo } = useContentInfo(pageId);
  // A show with exactly one season lists that season (one tap fewer).
  const [soleSeason, setSoleSeason] = useState(null);
  const soleSeasonPath = soleSeason?.forPath === path ? soleSeason.path : null;
  const listPath = soleSeasonPath ?? path;
  const listModifiers = useMemo(
    () => (/^\/?[^/]+\/[^/]+/.test(String(listPath)) ? { ...modifiers, expand: true } : modifiers),
    [listPath, modifiers],
  );
  const retryButtonRef = useRef(null);
  const appendFocusRef = useRef(null);
  const rememberAppendFocus = React.useCallback((added) => {
    if (retryButtonRef.current?.matches(':focus')) {
      const first = added[0];
      appendFocusRef.current = { path, id: first?.id ?? first?.itemId };
    }
  }, [path]);
  const { items: rawItems, total, loading, loadingMore = false, error, appendError, loadMore, reload } = useListBrowse(
    listPath, { modifiers: listModifiers, take, initialTake: loadedCount, onPageAppended: rememberAppendFocus },
  );
  const items = useMemo(() => dedupeSourceRows(naturalBrowseOrder(rawItems)), [rawItems]);
  const [oneShot, setOneShot] = useState(null);
  // A row's ⋯ menu closes itself on Escape; registering it keeps that Escape from also going Back.
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  useDismissLayer(rowMenuOpen, () => {}, { managed: true });
  const { push, replace } = useNav();
  const { dispatchLeafVerb, playContainerAsQueue, addContainerToQueue } = useContentDispatch();
  const { extraActions, runHousehold } = useHouseholdResultActions();
  const { labelsFor, destinationFor } = usePlayDestination();
  // Addendum items 5–7: the ⋯ entries (one table), "On <screen>" and the
  // pressed ▶'s own spinner come from the same row labels search uses.
  const { rowExtrasFor, screenFor } = useRowExtras();
  // A row's ▶ and its ⋯ Play say where they play, the same words as search.
  const rowLabelsFor = (row) => {
    const shared = rowExtrasFor(row);
    const { short, sentence } = labelsFor(row);
    const where = destinationFor(row);
    const elsewhere = where.targetIds.length > 0;
    return {
      playElsewhere: elsewhere,
      play: short,
      playTitle: row.title ? sentence.replace(/^Play/, `Play ${row.title}`) : sentence,
      playNow: where.source === 'ask' ? null : sentence,
      playHere: elsewhere ? 'Play here' : null,
      queueWhere: elsewhere ? short : null,
      menu: shared?.menu ?? null,
      onMenuMore: shared?.onMenuMore ?? null,
      playingOn: shared?.playingOn ?? null,
      playBusy: !!shared?.playBusy,
    };
  };
  const log = useMemo(() => getLogger().child({ component: 'browse-view' }), []);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const rootRef = regionProps.ref;
  const sentinelRef = useRef(null);
  const restoredEntryRef = useRef(null);

  // Never a raw id: the caller's label, else the page's own title, else the
  // source's name ("Movies & TV"); "…" while the title is on its way.
  const segments = splitPath(path);
  const crumbLabel = label ?? pageInfo?.title ?? (segments.length === 0 ? 'All'
    : segments.length === 1 ? (sourceLabel(segments[0]) ?? segments[0]) : '…');

  // The header item: the page's info once read, else the tapped row it was
  // opened from. Root/category levels have neither, so no header there.
  const headerItem = useMemo(() => {
    if (!pageId) return null;
    const base = pageInfo ? { ...(containerItem ?? {}), ...pageInfo, id: pageId } : (containerItem ? { ...containerItem, id: containerItem.id ?? pageId } : null);
    return headerWorthy(base) ? base : null;
  }, [pageId, pageInfo, containerItem]);
  const isContainerView = !!headerItem;
  const containerId = headerItem?.id ?? null;

  // A person or artist page lists its items by kind ("Books (14)").
  const sections = useMemo(() => sectionsFor(headerItem, items), [headerItem, items]);
  const headerPlayRef = useRef(null);

  // Breadcrumbs: the trail the person took, else (a page opened by its
  // address) the content's own parents.
  const trail = breadcrumbs.length > 0
    ? breadcrumbs
    : ancestorsOf(pageInfo).map((a) => ({ path: pathFor(a.contentId), label: a.title }));

  useEffect(() => {
    if (soleSeasonPath || loading || error) return;
    const season = soleSeasonOf(headerItem, rawItems, total);
    const seasonId = season ? (season.id ?? season.itemId) : null;
    if (!seasonId) return;
    mediaLog.browseSoleSeason({ contentId: containerId, seasonId });
    setSoleSeason({ forPath: path, path: pathFor(seasonId) });
  }, [soleSeasonPath, loading, error, headerItem, rawItems, total, containerId, path]);

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
    // restoration against that stale DOM or before an incomplete page finishes.
    if (focusedId && !focusTarget && (error || rawItems.length < total)) return;
    restoredEntryRef.current = entryKey;
    const host = findScrollHost(rootRef.current);
    if (host) host.scrollTop = scrollTop || 0;
    focusTarget?.focus({ preventScroll: true });
    if (focusedId && !focusTarget && document.activeElement === document.body) {
      rootRef.current.focus({ preventScroll: true });
    }
  }, [error, focusedId, items, loading, path, rawItems.length, rootRef, scrollTop, total]);

  // Focus on arrival (jellyfin study rec 12): Back returns to the row you
  // left (above); otherwise a container page puts focus on its PLAY, unless
  // the person is already typing or focused somewhere on this page.
  const playFocusedForRef = useRef(null);
  useEffect(() => {
    if (focusedId || !isContainerView || playFocusedForRef.current === path) return;
    const play = headerPlayRef.current;
    if (!play || play.disabled) return;
    const active = document.activeElement;
    const typing = active && (active.matches?.('input, textarea, [contenteditable="true"]'));
    playFocusedForRef.current = path;
    if (typing || (active && active !== document.body && rootRef.current?.contains(active))) return;
    play.focus({ preventScroll: true });
  }, [focusedId, isContainerView, path, rootRef, headerItem]);

  useLayoutEffect(() => {
    const target = appendFocusRef.current;
    appendFocusRef.current = null;
    if (!target || target.path !== path || document.activeElement !== document.body) return;
    const rows = [...(rootRef.current?.querySelectorAll('[data-browse-focus-id]') ?? [])];
    const row = rows.find(node => node.dataset.browseFocusId === String(target.id));
    (row ?? rows.at(-1) ?? rootRef.current)?.focus();
  }, [rawItems, path, rootRef]);

  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || loading || loadingMore || appendError || rawItems.length >= total || typeof IntersectionObserver === 'undefined') return undefined;
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (active && node.isConnected && entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: findScrollHost(rootRef.current), rootMargin: '160px' });
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [appendError, rawItems.length, loadMore, loading, loadingMore, rootRef, total]);

  const pushFromBrowse = (view, params, focusedId) => {
    const host = findScrollHost(rootRef.current);
    // loadedCount: pages past the first exist only because the person scrolled
    // to them; Back must re-fetch that many or the focused row never returns.
    const currentPatch = { path, scrollTop: host?.scrollTop ?? 0, focusedId, loadedCount: rawItems.length };
    push(view, params, { currentPatch });
  };

  const openDetail = (id) => pushFromBrowse('detail', { contentId: id }, id);

  const openContainer = (row, id) => {
    pushFromBrowse('browse', {
      path: String(id).replace(':', '/'),
      label: row.title ?? id,
      modifiers,
      containerItem: { ...row, id },
      breadcrumbs: [...trail, { path, label: crumbLabel, containerItem }],
    }, id);
  };

  const openCrumb = (crumb, index) => {
    mediaLog.browseCrumbOpened({ from: containerId, to: crumb.path, depth: index });
    replace('browse', { ...crumb, breadcrumbs: trail.slice(0, index) });
  };

  const openParent = (parent) => {
    mediaLog.parentOpened({ from: containerId, to: parent.contentId, surface: 'browse' });
    pushFromBrowse('browse', { path: pathFor(parent.contentId), label: parent.title, modifiers }, null);
  };

  // Sum of a one-book album's tracks: "Book · 2009 · 9 hr 5 min".
  const durationSeconds = useMemo(() => {
    if (!items.length || items.length !== total) return null;
    const sum = items.reduce((acc, row) => acc + (Number(row.duration ?? row.metadata?.duration) || 0), 0);
    return sum > 0 ? sum : null;
  }, [items, total]);

  const renderRow = (row) => {
            const id = row.id ?? row.itemId;
            if (!id) return null;
            const rowIsContainer = row.itemType === 'container';
            // A source ("Movies & TV") is entered, not played: › opens it, Play lives in ⋮.
            const isSourceRow = rowIsContainer && /^[\w-]+:$/.test(String(id));
            return (
              <li key={id} data-testid={`browse-row-${id}`} className="browse-row result-row"
                onPointerEnter={rowIsContainer && !isSourceRow ? () => prefetchBrowse(id, { modifiers }) : undefined}
                onFocus={rowIsContainer && !isSourceRow ? () => prefetchBrowse(id, { modifiers }) : undefined}>
                <ResultRow
                  item={{ ...row, id }}
                  title={sourceRootPresentation(row).title}
                  subtitle={(isSourceRow ? null : rowExtrasFor({ ...row, id }).playingOn?.onLine)
                    ?? watchedSubtitle(sourceRootPresentation(row).subtitle, watchState(row))}
                  thumbnail={row.thumbnail}
                  leading={row.thumbnail ? null : sourceIconFor(row)}
                  testId={`browse-open-${id}`}
                  focusId={id}
                  onTap={() => rowIsContainer ? openContainer(row, id) : openDetail(id)}
                  onPlayAll={isSourceRow ? null : () => {
                    const route = rowIsContainer ? playContainerAsQueue(id, row) : dispatchLeafVerb('playNow', id, row);
                    if (route === 'ask') setOneShot({ kind: 'playOn', item: { ...row, id } });
                  }}
                  rowLabels={isSourceRow ? null : rowLabelsFor({ ...row, id })}
                  extraActions={extraActions}
                  onMenuOpenChange={setRowMenuOpen}
                  onAction={action => {
                  if (runHousehold(action.kind, { ...row, id })) return;
                  if (action.kind === 'openScreen') { const deviceId = screenFor({ ...row, id }); if (deviceId) push('peek', { deviceId }); return; }
                  if (action.kind === 'playHere') dispatchLeafVerb('playNow', id, row, { targetIds: [] });
                  else if (['playOn', 'addOn'].includes(action.kind)) setOneShot(action);
                  else if (action.kind === 'details') openDetail(id);
                  else if (dispatchLeafVerb(action.kind, id, row) === 'ask') setOneShot({ kind: 'playOn', item: { ...row, id } });
                  }}
                />
                {rowIsContainer && <IconChevronRight size={18} aria-hidden />}
              </li>
            );
  };

  return (
    <Stack role="region" aria-label="Browse results" {...regionProps} data-testid="browse-view" className="browse-view" gap="md">
      <nav className="browse-breadcrumb" aria-label="Breadcrumb">
        <UnstyledButton
          data-testid="browse-crumb-home"
          className="browse-crumb browse-crumb--home"
          onClick={() => replace('home', {})}
        >
          Home
        </UnstyledButton>
        {trail.map((crumb, index) => (
          <React.Fragment key={`${crumb.path}-${index}`}>
            <span className="browse-crumb-sep" aria-hidden="true">/</span>
            <UnstyledButton
              className="browse-crumb"
              data-testid={`browse-crumb-parent-${index}`}
              onPointerEnter={() => prefetchBrowse(contentIdFromPath(crumb.path), { modifiers })}
              onFocus={() => prefetchBrowse(contentIdFromPath(crumb.path), { modifiers })}
              onClick={() => openCrumb(crumb, index)}
            >
              {crumb.label}
            </UnstyledButton>
          </React.Fragment>
        ))}
        <span className="browse-crumb-sep" aria-hidden="true">/</span>
        {/* The current page is a link too: it goes to the top of this page. */}
        <UnstyledButton
          className="browse-crumb browse-crumb--current"
          aria-current="page"
          data-testid="browse-crumb-current"
          onClick={() => { const host = findScrollHost(rootRef.current); if (host) host.scrollTop = 0; }}
        >
          {crumbLabel}
        </UnstyledButton>
      </nav>

      {isContainerView && (
        <BrowseHeader
          item={headerItem}
          contentId={containerId}
          itemCount={total || null}
          durationSeconds={durationSeconds}
          unwatched={unwatchedCount(items, total)}
          onOpenParent={openParent}
          onPrefetchParent={(parent) => prefetchBrowse(parent.contentId, { modifiers })}
          playRef={headerPlayRef}
        />
      )}

      {loading && (
        <Stack gap="xs" data-testid="browse-view-loading">
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={56} radius="sm" />)}
        </Stack>
      )}
      {error && <LoadErrorLine kind="section" testId="browse-view-error" onRetry={retry} />}
      {!loading && !error && items.length === 0 && (
        <Text c="dimmed" data-testid="browse-empty" className="browse-empty">Nothing here yet.</Text>
      )}

      {!loading && !error && (sections
        ? sections.map((section) => (
          <section key={section.key} aria-label={section.label} data-testid={`browse-section-${section.key}`}>
            <Text component="h2" className="browse-section-title">{section.label} ({section.items.length})</Text>
            <ul className="browse-list">
              <TopMoreList items={section.items} n={SECTION_SHOWN} getId={(row) => row.id ?? row.itemId}
                keepIds={focusedId ? [focusedId] : []} moreAs="li" testId={`browse-section-${section.key}`}
                onExpand={(counts) => mediaLog.listMoreExpanded({ surface: `browse-section-${section.key}`, ...counts })}
                renderItem={(row) => renderRow(row)} />
            </ul>
          </section>
        ))
        : (
          <ul className="browse-list">
            {items.map((row) => renderRow(row))}
          </ul>
        ))}
      {appendError && (
        <StateMessage state="error" role="alert" detail="More titles couldn't be loaded.">
          <Button ref={retryButtonRef} density="compact" variant="secondary"
            aria-disabled={loadingMore || undefined} aria-busy={loadingMore || undefined}
            onClick={() => { if (!loadingMore) loadMore(); }}>
            {loadingMore ? 'Retrying…' : 'Retry'}
          </Button>
        </StateMessage>
      )}
      {!loading && !error && !appendError && rawItems.length < total && (
        <div ref={sentinelRef} data-testid="browse-page-sentinel" role="status" aria-label="Loading more titles" style={{ minHeight: 1 }}>
          {loadingMore ? 'Loading more…' : ''}
        </div>
      )}
      <ItemDestinationPicker action={oneShot} onClose={() => setOneShot(null)} />
    </Stack>
  );
}

export default BrowseView;
