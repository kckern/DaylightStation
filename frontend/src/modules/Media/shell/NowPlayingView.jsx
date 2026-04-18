import React from 'react';
import { useSessionController } from '../session/useSessionController.js';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  return (
    <div data-testid="now-playing-view">
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
    </div>
  );
}

export default NowPlayingView;
