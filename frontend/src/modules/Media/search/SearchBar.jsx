import React, { useState, useRef, useCallback } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';
import { SearchIdleState } from './SearchIdleState.jsx';
import { SearchEmptyState } from './SearchEmptyState.jsx';
import { SearchErrorState } from './SearchErrorState.jsx';
import { deriveSearchState, SEARCH_STATE } from './searchStates.js';
import { parseContentId } from './contentIdParser.js';
import { useDismissable } from '../../../hooks/useDismissable.js';
import { useSessionController } from '../session/useSessionController.js';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, error, setQuery, retry } = useLiveSearch({
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

  useDismissable(rootRef, { open: isOpen, onDismiss: close });

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

  const state = deriveSearchState({
    query: value,
    isSearching,
    results,
    error,
  });
  const parsedId = parseContentId(value);

  return (
    <div
      data-testid="media-search-bar"
      className="media-search-bar"
      ref={rootRef}
      onFocus={() => setFocused(true)}
    >
      <select
        data-testid="media-search-scope"
        value={currentScopeKey ?? ''}
        onChange={(e) => setScopeKey(e.target.value)}
      >
        {scopes.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
      <input
        data-testid="media-search-input"
        value={value}
        onChange={onChange}
        placeholder="Search media — title, artist, or paste a content ID (plex-main:12345)"
      />
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
              Searching{pending.length > 0 ? ` (${pending.join(', ')})` : ''}…
            </div>
          )}
          {state.kind === SEARCH_STATE.RESULTS && (
            <SearchResults results={state.results} pending={pending} onAction={close} />
          )}
          {state.kind === SEARCH_STATE.EMPTY && <SearchEmptyState query={state.query} />}
          {state.kind === SEARCH_STATE.ERROR && (
            <SearchErrorState error={state.error} onRetry={retry} />
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBar;
