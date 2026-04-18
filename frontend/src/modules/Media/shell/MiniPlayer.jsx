// frontend/src/modules/Media/shell/MiniPlayer.jsx
import React from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { useNav } from './NavProvider.jsx';

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const { push } = useNav();
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;
  return (
    <div data-testid="media-mini-player">
      <button
        data-testid="mini-player-open-nowplaying"
        onClick={() => push('nowPlaying', {})}
      >
        {item.title ?? item.contentId}
      </button>
      <button onClick={transport.pause} data-testid="mini-pause">Pause</button>
      <button onClick={transport.play} data-testid="mini-play">Play</button>
    </div>
  );
}

export default MiniPlayer;
