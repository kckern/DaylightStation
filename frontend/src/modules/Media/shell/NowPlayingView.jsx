import React, { useRef, useEffect } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { useNav } from './NavProvider.jsx';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { pop, depth } = useNav();

  const goBack = () => {
    if (depth > 1) pop();
    else window.history.back?.();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        goBack();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depth, pop]);

  return (
    <div data-testid="now-playing-view">
      <div className="now-playing-toolbar">
        <button
          data-testid="now-playing-back"
          className="now-playing-back-btn"
          onClick={goBack}
          aria-label="Back"
        >
          ← Back
        </button>
      </div>
      <h2>Now Playing: {item?.contentId ?? 'nothing'}</h2>
      <div>state: {snapshot.state}</div>
      <div>position: {Math.round(snapshot.position ?? 0)}s</div>
      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />
      {item && (
        <div className="handoff-section" data-testid="handoff-section">
          <DispatchTargetPicker
            source={{ snapshot }}
            submitLabel="Hand off"
            onComplete={() => { /* non-blocking; let the user navigate naturally */ }}
          />
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
