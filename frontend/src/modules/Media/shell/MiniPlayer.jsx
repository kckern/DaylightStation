import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

export function MiniPlayer() {
  const { snapshot, transport } = useSessionController('local');
  const item = snapshot.currentItem;
  if (!item) return <div data-testid="media-mini-player">Idle</div>;
  return (
    <div data-testid="media-mini-player">
      <span data-testid="mini-player-title">{item.title ?? item.contentId}</span>
      <button onClick={transport.pause} data-testid="mini-pause">Pause</button>
      <button onClick={transport.play} data-testid="mini-play">Play</button>
    </div>
  );
}

export default MiniPlayer;
