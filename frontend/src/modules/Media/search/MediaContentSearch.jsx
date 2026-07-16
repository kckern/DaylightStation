// frontend/src/modules/Media/search/MediaContentSearch.jsx
// The dock's content picker: the shared ContentCombobox wired as a TRANSIENT
// selector. It never persists a value (always value=""); selecting an item —
// whether typed-and-picked or drilled show→season→episode — hands the id to
// useContentDispatch, which routes it to local playback or a cast target based
// on the active view. Containers DRILL (selectContainers={false}); only leaves
// dispatch. A scope <select> (from SearchProvider) narrows the search sources
// via ContentCombobox's searchParams passthrough.
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
    dispatch(id, item);
    log.info('dispatch', { contentId: id });
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
            selectContainers={false}
            searchParams={currentScope?.params ?? ''}
            appResults
            allowFreeform={false}
          />
        </div>
      </div>
    </div>
  );
}

export default MediaContentSearch;
