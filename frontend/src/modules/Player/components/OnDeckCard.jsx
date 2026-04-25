import React from 'react';
import './OnDeckCard.scss';

export function OnDeckCard({ item, flashKey }) {
  if (!item) return null;
  return (
    <div className="on-deck-card" data-flash-key={flashKey}>
      <div className="on-deck-thumb">
        {item.thumbnail && <img src={item.thumbnail} alt={item.title || 'thumbnail'} />}
        <div className="on-deck-icon" aria-label="up next">▶▶</div>
      </div>
      <div className="on-deck-title-strip">
        {item.title || ''}
      </div>
    </div>
  );
}

export default OnDeckCard;
