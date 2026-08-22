// frontend/src/modules/Media/search/MediaContentSearch.jsx
// The dock's content picker: the shared ContentCombobox wired as a TRANSIENT
// selector. It never persists a value (always value=""); selecting an item
// hands the id to useContentDispatch, which routes it to the full browse view,
// local playback, or a cast target based on the active view.
//
// Containers SELECT (selectContainers), they do not drill in the popover:
// picking "Tuttle Twins" opens the show on the canvas, where BrowseView has
// breadcrumbs, back, per-row Play Now, and survives a blur. In-popover
// drilling looked equivalent but threw the whole traversal away on close —
// on 2026-08-12 a user drilled show→season twice in 20s and still had to
// leave for Plex Web to find an episode id.
//
// Scope chips (ScopeChips.jsx, from SearchProvider's context) narrow the
// search sources via ContentCombobox's searchParams passthrough.
//
// Task 14 (spec D6): the same ONE tap grammar as SearchMode's mobile list.
// Row tap already routes through useContentDispatch's dispatch() (leaf ->
// play now, container -> ALWAYS browse — no change needed here for that
// part, it's the hook's job). What's new is the trailing verbs: ContentCombobox
// takes optional onPlayAll/onMore props (additive — every other caller of
// that shared, widely-used component leaves them unset and gets zero
// behavior change) that light up ResultRowActions on the container ▶ and
// leaf ⋯ respectively, wired to the exact same playContainerAsQueue /
// applyResultRowVerb plumbing SearchMode uses.
import React, { useCallback, useMemo } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ContentCombobox } from '../../Content/combobox/ContentCombobox.jsx';
import { useSearchContext } from './SearchProvider.jsx';
import { ScopeChips } from './ScopeChips.jsx';
import { useContentDispatch } from './useContentDispatch.js';
import { useSessionController } from '../controller/useSessionController.js';
import { useNav } from '../shell/NavProvider.jsx';
import { applyResultRowVerb } from './resultRowVerbs.js';
import { notifications } from '@mantine/notifications';
import getLogger from '../../../lib/logging/Logger.js';
import './Search.scss';

export function MediaContentSearch() {
  const { scopes, currentScopeKey, currentScope, scopeError } = useSearchContext();
  const { dispatch, playContainerAsQueue } = useContentDispatch();
  const { queue } = useSessionController('local');
  const { push } = useNav();
  const log = useMemo(() => getLogger().child({ component: 'media-content-search' }), []);

  // Transient: ContentCombobox reverts to value="" on close, so a selection is
  // a one-shot dispatch, never a committed/persisted value.
  const handleChange = useCallback((id, item) => {
    if (!id) return; // clear/empty commits are no-ops for a transient picker
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null });
    // `route` is 'peek' | 'cast' | 'browse' | 'local' — without it, a selection that went
    // to the wrong surface is invisible in the logs. It records the routing
    // INTENT, not the outcome: the cast dispatch is async and unawaited, so a
    // dispatch that later fails (or is swallowed by the dedupe window) still
    // logs route:'cast'. Outcome lives in dispatch.succeeded/failed/deduplicated.
    const route = dispatch(id, item);
    log.info('dispatch', { contentId: id, route });
  }, [dispatch, log]);

  // Trailing ▶ on a container row: send the whole thing to the current
  // destination. Same toast treatment as a local leaf dispatch — a cast
  // already toasts via useContentDispatch itself.
  const handlePlayAll = useCallback((item) => {
    const id = item?.id;
    if (!id) return;
    log.info('select', { contentId: id, title: item?.title ?? null, type: item?.type ?? null, verb: 'playAll' });
    const route = playContainerAsQueue(id, item);
    log.info('dispatch', { contentId: id, route, verb: 'playAll' });
    if (route === 'local') {
      notifications.show({
        id: 'media-content-search-dispatch-local',
        color: 'teal',
        autoClose: 2500,
        title: item?.title ? `Playing ${item.title}` : 'Playing',
      });
    }
  }, [playContainerAsQueue, log]);

  // Trailing ⋯ on a leaf row: Play Now / Play Next / Up Next / Add to Queue
  // / Open detail.
  const handleMore = useCallback((action, item) => {
    const id = item?.id;
    if (!id) return;
    log.info('row_action', { contentId: id, action });
    applyResultRowVerb(action, item, { queue, push });
  }, [queue, push, log]);

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <div className="media-search-controls">
        <ScopeChips />
        {scopeError && (
          <span data-testid="scope-error" className="scope-error" title={scopeError.message}>
            <IconAlertTriangle size={16} aria-label="Scope config failed to load" />
          </span>
        )}
        <div className="media-search-input-wrap">
          <ContentCombobox
            value=""
            onChange={handleChange}
            onPlayAll={handlePlayAll}
            onMore={handleMore}
            placeholder="Search media…"
            selectContainers
            searchParams={currentScope?.params ?? ''}
            // D5: scopes[0] is the catalog-wide ("All") scope by convention
            // (SearchProvider seeds currentScopeKey from it and resetScope()
            // returns to it) — that's what a scoped search settling empty
            // silently widens to. scopeKey/scopeLabel are for observability
            // and for naming the scope in the widened-search notice.
            fallbackSearchParams={scopes[0]?.params ?? ''}
            scopeKey={currentScopeKey}
            scopeLabel={currentScope?.label ?? null}
            logApp="media"
            appResults
            allowFreeform={false}
          />
        </div>
      </div>
    </div>
  );
}

export default MediaContentSearch;
