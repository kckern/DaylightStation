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
// A scope <select> (from SearchProvider) narrows the search sources via
// ContentCombobox's searchParams passthrough.
import React, { useCallback, useMemo } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ContentCombobox } from '../../Content/combobox/ContentCombobox.jsx';
import { useSearchContext } from './SearchProvider.jsx';
import { useContentDispatch } from './useContentDispatch.js';
import getLogger from '../../../lib/logging/Logger.js';

export function MediaContentSearch() {
  const { scopes, currentScopeKey, currentScope, scopeError, setScopeKey } = useSearchContext();
  const dispatch = useContentDispatch();
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

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <div className="media-search-controls">
        <select
          data-testid="media-search-scope"
          className="media-search-scope"
          aria-label="Search scope"
          value={currentScopeKey ?? ''}
          onChange={(e) => setScopeKey(e.target.value)}
        >
          {scopes.map((s) => (
            Array.isArray(s.children) && s.children.length > 0 ? (
              <optgroup key={s.key} label={s.label}>
                {s.params != null && <option value={s.key}>All {s.label}</option>}
                {s.children.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ) : (
              <option key={s.key} value={s.key}>{s.label}</option>
            )
          ))}
        </select>
        {scopeError && (
          <span data-testid="scope-error" className="scope-error" title={scopeError.message}>
            <IconAlertTriangle size={16} aria-label="Scope config failed to load" />
          </span>
        )}
        <div className="media-search-input-wrap">
          <ContentCombobox
            value=""
            onChange={handleChange}
            placeholder="Search media…"
            selectContainers
            searchParams={currentScope?.params ?? ''}
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
