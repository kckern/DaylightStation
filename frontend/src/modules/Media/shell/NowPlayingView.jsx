// frontend/src/modules/Media/shell/NowPlayingView.jsx
import React, { useRef } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);

  return (
    <div data-testid="now-playing-view">
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />
    </div>
  );
}

export default NowPlayingView;
