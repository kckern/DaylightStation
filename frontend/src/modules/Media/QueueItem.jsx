// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useMemo } from 'react';
import { ContentDisplayUrl } from '../../lib/api.mjs';

const QueueItem = ({ item, isCurrent, onPlay, onRemove }) => {
  const thumbnailUrl = useMemo(
    () => item.contentId ? ContentDisplayUrl(item.contentId) : null,
    [item.contentId]
  );

  const handleSwipeRemove = useCallback((e) => {
    const startX = e.touches?.[0]?.clientX;
    const handler = (moveEvent) => {
      const dx = moveEvent.touches[0].clientX - startX;
      if (dx < -80) {
        document.removeEventListener('touchmove', handler);
        onRemove(item.queueId);
      }
    };
    document.addEventListener('touchmove', handler, { passive: true });
    document.addEventListener('touchend', () => {
      document.removeEventListener('touchmove', handler);
    }, { once: true });
  }, [item.queueId, onRemove]);

  return (
    <div
      className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
      onClick={() => onPlay(item.queueId)}
      onTouchStart={handleSwipeRemove}
    >
      <div className="queue-item-thumbnail">
        {thumbnailUrl && <img src={thumbnailUrl} alt="" />}
      </div>
      <div className="queue-item-info">
        <div className="queue-item-title">{item.title || item.contentId}</div>
        {item.source && <div className="queue-item-source">{item.source}</div>}
      </div>
      {item.format && <span className="queue-item-badge">{item.format}</span>}
      <button
        className="queue-item-remove"
        onClick={(e) => { e.stopPropagation(); onRemove(item.queueId); }}
        aria-label="Remove"
      >
        &times;
      </button>
    </div>
  );
};

export default QueueItem;
