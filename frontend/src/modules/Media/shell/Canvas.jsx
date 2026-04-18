import React from 'react';
import { NowPlayingView } from './NowPlayingView.jsx';

// In P1, the canvas is always the NowPlayingView. P2 will introduce the view registry.
export function Canvas() {
  return (
    <div data-testid="media-canvas">
      <NowPlayingView />
    </div>
  );
}

export default Canvas;
