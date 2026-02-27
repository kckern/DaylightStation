// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useMemo } from 'react';
import CastButton from './CastButton.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';

const QueueItem = ({ item, isCurrent, onPlay, onRemove, index, onDragStart, onDrop, onDragEnd }) => {
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
      draggable
      onClick={() => onPlay(item.queueId)}
      onTouchStart={handleSwipeRemove}
      onDragStart={() => onDragStart?.(item.queueId)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop?.(index); }}
      onDragEnd={() => onDragEnd?.()}
    >
      <span className="queue-item-drag-handle" aria-hidden="true">&#8942;</span>
      <div className="queue-item-thumbnail">
        {thumbnailUrl && <img src={thumbnailUrl} alt="" />}
      </div>
      <div className="queue-item-info">
        <div className="queue-item-title">{item.title || item.contentId}</div>
        {item.source && <div className="queue-item-source">{item.source}</div>}
      </div>
      {item.format && <span className="queue-item-badge">{item.format}</span>}
      <CastButton contentId={item.contentId} className="queue-item-cast" />
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
