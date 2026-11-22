import React from 'react';

export function FeedLoadingIndicator({ label }) {
  return (
    <div className="feed-loading-indicator" role="status" aria-live="polite" aria-atomic="true">
      <span className="feed-visually-hidden">{label}</span>
      <div className="feed-loading-indicator__dots" aria-hidden="true">
        <span /><span /><span />
      </div>
    </div>
  );
}

export default FeedLoadingIndicator;
