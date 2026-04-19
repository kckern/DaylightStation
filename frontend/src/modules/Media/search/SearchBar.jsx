import React, { useState } from 'react';
import { useLiveSearch } from './useLiveSearch.js';
import { useSearchContext } from './SearchProvider.jsx';
import { SearchResults } from './SearchResults.jsx';

export function SearchBar() {
  const { scopes, currentScopeKey, currentScope, setScopeKey } = useSearchContext();
  const { results, pending, isSearching, setQuery } = useLiveSearch({
    scopeParams: currentScope?.params ?? '',
  });
  const [value, setValue] = useState('');

  const onChange = (e) => {
    const next = e.target.value;
    setValue(next);
    setQuery(next);
  };

  return (
    <div data-testid="media-search-bar" className="media-search-bar">
      <span className="media-search-bar__glyph" aria-hidden="true">⌕</span>
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
        placeholder="Search the catalog…"
      />
      {value.length >= 2 && (
        <SearchResults results={results} pending={pending} isSearching={isSearching} />
      )}
    </div>
  );
}

export default SearchBar;
