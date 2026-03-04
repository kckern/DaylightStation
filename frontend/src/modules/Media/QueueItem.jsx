// frontend/src/modules/Media/QueueItem.jsx
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import CastButton from './CastButton.jsx';
import { ContentDisplayUrl } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const QueueItem = ({ item, isCurrent, onPlay, onRemove, index, onDragStart, onDrop, onDragEnd }) => {
  const thumbnailUrl = useMemo(
    () => item.contentId ? ContentDisplayUrl(item.contentId) : null,
    [item.contentId]
  );

  const logger = useMemo(() => getLogger().child({ component: 'QueueItem' }), []);

  const activeTouchHandler = useRef(null);

  useEffect(() => {
    return () => {
      if (activeTouchHandler.current) {
        document.removeEventListener('touchmove', activeTouchHandler.current);
        activeTouchHandler.current = null;
      }
    };
  }, []);

  const handleSwipeRemove = useCallback((e) => {
    const startX = e.touches?.[0]?.clientX;
    const handler = (moveEvent) => {
      const dx = moveEvent.touches[0].clientX - startX;
      if (dx < -80) {
        activeTouchHandler.current = null;
        document.removeEventListener('touchmove', handler);
        logger.info('queue-item.swipe-remove', { queueId: item.queueId, contentId: item.contentId, title: item.title });
        onRemove(item.queueId);
      }
    };
    activeTouchHandler.current = handler;
    document.addEventListener('touchmove', handler, { passive: true });
    document.addEventListener('touchend', () => {
      activeTouchHandler.current = null;
      document.removeEventListener('touchmove', handler);
    }, { once: true });
  }, [item.queueId, onRemove]);

  return (
    <div
      className={`queue-item ${isCurrent ? 'queue-item--current' : ''}`}
      draggable
      onClick={() => { logger.info('queue-item.play-clicked', { queueId: item.queueId, contentId: item.contentId }); onPlay(item.queueId); }}
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
        onClick={(e) => { e.stopPropagation(); logger.info('queue-item.remove-clicked', { queueId: item.queueId, contentId: item.contentId }); onRemove(item.queueId); }}
        aria-label="Remove"
      >
        &times;
      </button>
    </div>
  );
};

export default QueueItem;
