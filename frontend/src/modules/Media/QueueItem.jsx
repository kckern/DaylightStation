// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useMemo, useRef } from 'react';
import CastButton from './CastButton.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const QueueItem = ({ item, isCurrent, onPlay, onRemove, index, onDragStart, onDrop, onDragEnd }) => {
  const thumbnailUrl = useMemo(
    () => item.thumbnail || (item.contentId ? ContentDisplayUrl(item.contentId) : null),
    [item.thumbnail, item.contentId]
  );

  const logger = useMemo(() => getLogger().child({ component: 'QueueItem' }), []);

  const touchRef = useRef({ startX: 0, startY: 0, moved: false });

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches?.[0];
    if (!touch) return;
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, moved: false };

    const handler = (moveEvent) => {
      const dx = moveEvent.touches[0].clientX - touchRef.current.startX;
      const dy = moveEvent.touches[0].clientY - touchRef.current.startY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        touchRef.current.moved = true;
      }
      if (dx < -80) {
        document.removeEventListener('touchmove', handler);
        logger.info('queue-item.swipe-remove', { queueId: item.queueId, contentId: item.contentId, title: item.title });
        onRemove(item.queueId);
      }
    };

    document.addEventListener('touchmove', handler, { passive: true });
    document.addEventListener('touchend', () => {
      document.removeEventListener('touchmove', handler);
    }, { once: true });
  }, [item.queueId, item.contentId, item.title, onRemove, logger]);

  const handleClick = useCallback(() => {
    if (touchRef.current.moved) return;
    logger.info('queue-item.play-clicked', { queueId: item.queueId, contentId: item.contentId });
    onPlay(item.queueId);
  }, [item.queueId, item.contentId, onPlay, logger]);

  return (
    <div
      className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
      draggable
      onClick={handleClick}
      onTouchStart={handleTouchStart}
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
        onClick={(e) => { e.stopPropagation(); logger.info('queue-item.remove-clicked', { queueId: item.queueId, contentId: item.contentId }); onRemove(item.queueId); }}
        aria-label="Remove"
      >
        &times;
      </button>
    </div>
  );
};

export default QueueItem;
