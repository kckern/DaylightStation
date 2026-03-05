// frontend/src/modules/Media/PlayerPanel.jsx
import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import NowPlaying from './NowPlaying.jsx';
import QueueDrawer from './QueueDrawer.jsx';
import { useMediaApp } from '../../contexts/MediaAppContext.jsx';
import getLogger from '../../lib/logging/Logger.js';

const PlayerPanel = ({ currentItem, onItemEnd, onNext, onPrev, onPlaybackState, playerRef }) => {
  const logger = useMemo(() => getLogger().child({ component: 'PlayerPanel' }), []);
  const navigate = useNavigate();
  const { queue } = useMediaApp();
  const [queueExpanded, setQueueExpanded] = useState(false);

  const handleCollapse = useCallback(() => {
    logger.debug('player-panel.collapse');
    navigate(-1);
  }, [navigate, logger]);

  // Next item in queue for "Up Next" preview
  const nextItem = useMemo(() => {
    if (!queue.items.length || queue.position >= queue.items.length - 1) return null;
    return queue.items[queue.position + 1];
  }, [queue.items, queue.position]);

  return (
    <div className="player-panel">
      {/* Collapse handle — mobile only */}
      <div className="player-panel-collapse" onClick={handleCollapse}>
        <div className="player-panel-collapse-bar" />
      </div>

      {/* Now Playing area */}
      <div className="player-panel-media">
        <NowPlaying
          currentItem={currentItem}
          onItemEnd={onItemEnd}
          onNext={onNext}
          onPrev={onPrev}
          onPlaybackState={onPlaybackState}
          playerRef={playerRef}
        />
      </div>

      {/* Queue — desktop: always visible; mobile: collapsible */}
      <div className={`player-panel-queue ${queueExpanded ? 'player-panel-queue--expanded' : ''}`}>
        {/* Mobile: Up Next preview bar */}
        <div className="player-panel-queue-preview" onClick={() => setQueueExpanded(!queueExpanded)}>
          <span className="queue-preview-label">
            {nextItem ? `Up Next: ${nextItem.title || nextItem.contentId}` : `Queue (${queue.items.length})`}
          </span>
          <span className="queue-preview-chevron">{queueExpanded ? '\u25BC' : '\u25B2'}</span>
        </div>
        {/* Full queue list */}
        <div className="player-panel-queue-list">
          <QueueDrawer />
        </div>
      </div>
    </div>
  );
};

export default PlayerPanel;
