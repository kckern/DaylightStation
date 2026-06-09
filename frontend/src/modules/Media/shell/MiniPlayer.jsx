// frontend/src/modules/Media/shell/MiniPlayer.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from './NavProvider.jsx';

const PLAYING_STATES = new Set(['playing', 'buffering']);

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const { push } = useNav();
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const toggleLabel = isPlaying ? 'Pause' : 'Play';
  const onToggle = () => {
    if (isPlaying) transport.pause();
    else transport.play();
  };
  const onStop = () => transport.stop();

  return (
    <div data-testid="media-mini-player">
      <button
        data-testid="mini-player-open-nowplaying"
        onClick={() => push('nowPlaying', {})}
      >
        {item.title ?? item.contentId}
        {snapshot.queue?.items?.length > 1 && snapshot.queue.currentIndex >= 0 && (
          <span className="mini-queue-count" data-testid="mini-queue-count">
            {snapshot.queue.currentIndex + 1}/{snapshot.queue.items.length}
          </span>
        )}
      </button>
      <button
        data-testid="mini-toggle"
        aria-label={toggleLabel}
        onClick={onToggle}
        className={`media-mini-player__toggle media-mini-player__toggle--${isPlaying ? 'playing' : 'paused'}`}
      >
        {isPlaying ? '❚❚' : '▶'}
      </button>
      <button
        data-testid="mini-stop"
        aria-label="Stop"
        onClick={onStop}
        className="media-mini-player__stop"
        title="Stop and clear current item"
      >
        ■
      </button>
    </div>
  );
}

export default MiniPlayer;
