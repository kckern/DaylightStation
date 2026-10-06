import React from 'react';
import { LoadErrorLine } from '../shared/LoadErrorLine.jsx';

// Raw adapter/stream errors ("abs timeout after 8000ms") never render —
// only our own copy does; the detail is already in the log.
export function SearchErrorState({ error, onRetry }) {
  return (
    <LoadErrorLine kind="search" error={error} onRetry={onRetry}
      testId="search-error" retryTestId="search-retry" className="search-state search-state--error" />
  );
}

export default SearchErrorState;
