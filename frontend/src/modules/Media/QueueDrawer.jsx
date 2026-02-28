// frontend/src/modules/Media/QueueDrawer.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import QueueItem from './QueueItem.jsx';
import getLogger from '../../lib/logging/Logger.js';

const QueueDrawer = () => {
  const { queue } = useMediaApp();
  const logger = useMemo(() => getLogger().child({ component: 'QueueDrawer' }), []);
  const [draggedId, setDraggedId] = useState(null);

  const handlePlay = useCallback((queueId) => {
    const idx = queue.items.findIndex(i => i.queueId === queueId);
    if (idx >= 0) {
      logger.info('queue.play-item', { queueId, index: idx });
      queue.setPosition(idx);
    }
  }, [queue, logger]);

  const handleRemove = useCallback((queueId) => {
    logger.info('queue.remove-item', { queueId });
    queue.removeItem(queueId);
  }, [queue, logger]);

  const handleClear = useCallback(() => {
    logger.info('queue.clear', { itemCount: queue.items.length });
    queue.clear();
  }, [queue, logger]);

  const cycleRepeat = useCallback(() => {
    const modes = ['off', 'one', 'all'];
    const next = modes[(modes.indexOf(queue.repeat) + 1) % modes.length];
    logger.debug('queue.repeat', { from: queue.repeat, to: next });
    queue.setRepeat(next);
  }, [queue, logger]);

  const handleDragStart = useCallback((queueId) => {
    setDraggedId(queueId);
  }, []);

  const handleDrop = useCallback((toIndex) => {
    if (draggedId == null) return;
    logger.info('queue.reorder', { queueId: draggedId, toIndex });
    queue.reorder(draggedId, toIndex);
    setDraggedId(null);
  }, [draggedId, queue, logger]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
  }, []);

  return (
    <div className="queue-drawer">
      <div className="queue-drawer-header">
        <h3>Queue ({queue.items.length})</h3>
        <div className="queue-drawer-actions">
          <button
            className={`queue-action-btn ${queue.shuffle ? 'active' : ''}`}
            onClick={() => { logger.debug('queue.shuffle', { enabled: !queue.shuffle }); queue.setShuffle(!queue.shuffle); }}
            aria-label="Shuffle"
          >
            &#8652;
          </button>
          <button
            className={`queue-action-btn ${queue.repeat !== 'off' ? 'active' : ''}`}
            onClick={cycleRepeat}
            aria-label={`Repeat: ${queue.repeat}`}
          >
            {queue.repeat === 'one' ? '\u21BB1' : '\u21BB'}
          </button>
          <button className="queue-action-btn" onClick={handleClear} aria-label="Clear">
            &#10005;
          </button>
        </div>
      </div>
      <div className="queue-drawer-list">
        {queue.items.length === 0 && (
          <div className="queue-empty">Queue is empty</div>
        )}
        {queue.items.map((item, idx) => (
          <QueueItem
            key={item.queueId}
            item={item}
            index={idx}
            isCurrent={idx === queue.position}
            onPlay={handlePlay}
            onRemove={handleRemove}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  );
};

export default QueueDrawer;
