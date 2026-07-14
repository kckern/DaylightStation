// frontend/src/modules/Media/search/SearchBar.jsx
// The dock's live search: scope selector + input + inline results dropdown
// (C1.1 — a combobox, never a results page). Queue actions keep the dropdown
// open; Play Now closes it and clears the query. A content-ID-looking query
// gets a pinned deep-link affordance instead of hijacking the search.
import React, { useState, useRef, useCallback } from 'react';
import { TextInput } from '@mantine/core';
import { IconSearch, IconAlertTriangle } from '@tabler/icons-react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';
import { SearchIdleState } from './SearchIdleState.jsx';
import { SearchEmptyState } from './SearchEmptyState.jsx';
import { SearchErrorState } from './SearchErrorState.jsx';
import { deriveSearchState, SEARCH_STATE } from './searchStates.js';
import { sourceLabelList } from './sourceLabels.js';
import { parseContentId } from './contentIdParser.js';
import { useDismissable } from '../../../hooks/useDismissable.js';
import { useSessionController } from '../controller/useSessionController.js';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, scopeError, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, error, sourceErrors, setQuery, retry } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const { queue } = useSessionController('local');
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const rootRef = useRef(null);

  const isOpen = focused || value.length >= 1;

  const close = useCallback(() => {
    setValue('');
    setFocused(false);
    setQuery('');
  }, [setQuery]);

  // Mantine portals (cast popovers opened from result rows) live outside this
  // subtree; pointerdowns inside them must not dismiss the search overlay.
  useDismissable(rootRef, { open: isOpen, onDismiss: close, ignore: '.media-app-portal, [data-portal]' });

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  const onDeepLink = ({ source, localId }) => {
    const contentId = `${source}:${localId}`;
    queue.playNow({ contentId }, { clearRest: true });
    close();
  };

  const state = deriveSearchState({ query: value, isSearching, results, error });
  const parsedId = parseContentId(value);

  return (
    <div
      data-testid="media-search-bar"
      className="media-search-bar"
      ref={rootRef}
      onFocus={() => setFocused(true)}
    >
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
        <TextInput
          className="media-search-input-wrap"
          size="md"
          radius="md"
          data-testid="media-search-input"
          leftSection={<IconSearch size={18} />}
          value={value}
          onChange={onChange}
          placeholder="Search media…"
          aria-label="Search"
        />
      </div>
      {isOpen && (
        <div data-testid="search-overlay" className="media-search-overlay">
          {parsedId && state.kind !== SEARCH_STATE.IDLE && (
            <SearchIdleState input={value} onDeepLink={onDeepLink} />
          )}
          {state.kind === SEARCH_STATE.IDLE && (
            <SearchIdleState input={value} onDeepLink={onDeepLink} />
          )}
          {state.kind === SEARCH_STATE.SEARCHING && (
            <div data-testid="search-loading" className="search-state search-state--loading">
              Searching…
            </div>
          )}
          {state.kind === SEARCH_STATE.RESULTS && (
            <SearchResults results={state.results} pending={pending} onAction={close} />
          )}
          {state.kind === SEARCH_STATE.EMPTY && (
            <SearchEmptyState query={state.query} sourceErrors={sourceErrors} onRetry={retry} />
          )}
          {state.kind === SEARCH_STATE.ERROR && (
            <SearchErrorState error={state.error} onRetry={retry} />
          )}
          {sourceErrors?.length > 0 && (
            <div data-testid="search-source-errors" className="search-source-errors">
              <span>
                ⚠ {sourceLabelList(sourceErrors.map((e) => e.source)).join(', ')}{' '}
                didn&rsquo;t respond
              </span>
              <button
                type="button"
                data-testid="search-source-errors-retry"
                className="search-source-errors-retry"
                onClick={retry}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
