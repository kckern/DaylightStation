import React, { useState, useRef, useCallback } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';
import { useDismissable } from '../../../hooks/useDismissable.js';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, setQuery } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const [value, setValue] = useState('');
  const rootRef = useRef(null);

  const isOpen = value.length >= 2;

  const close = useCallback(() => {
    setValue('');
    setQuery('');
  }, [setQuery]);

  useDismissable(rootRef, { open: isOpen, onDismiss: close });

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  return (
    <div data-testid="media-search-bar" className="media-search-bar" ref={rootRef}>
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
        placeholder="Search"
      />
      {isOpen && (
        <SearchResults results={results} pending={pending} isSearching={isSearching} onAction={close} />
      )}
    </div>
  );
}

export default SearchBar;
