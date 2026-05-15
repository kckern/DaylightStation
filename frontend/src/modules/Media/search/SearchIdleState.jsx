import React from 'react';
import { parseContentId } from './contentIdParser.js';

export function SearchIdleState({ input, onDeepLink }) {
  const parsed = parseContentId(input);
  return (
    <div data-testid="search-idle" className="search-state search-state--idle">
      {parsed ? (
        <>
          <div data-testid="search-deeplink-suggestion" className="search-deeplink-suggestion">
            Looks like a content ID: <code>{parsed.source}:{parsed.localId}</code>
          </div>
          <button
            data-testid="search-deeplink-play"
            className="search-deeplink-btn"
            onClick={() => onDeepLink?.(parsed)}
          >
            Play this ID
          </button>
        </>
      ) : (
        <div data-testid="search-idle-prompt" className="search-idle-prompt">
          Start typing to search the catalog.
        </div>
      )}
    </div>
  );
}

export default SearchIdleState;
