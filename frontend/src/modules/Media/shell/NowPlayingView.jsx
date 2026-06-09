import React, { useRef, useEffect, useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { DispatchTargetPicker } from '../cast/DispatchTargetPicker.jsx';
import { QueuePanel } from './QueuePanel.jsx';
import { useNav } from './NavProvider.jsx';

const PLAYING_STATES = new Set(['playing', 'buffering']);

function fmt(s) {
  const t = Math.max(0, Math.floor(s ?? 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

export function NowPlayingView() {
  const { snapshot, transport, config } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { pop, depth } = useNav();
  const [scrub, setScrub] = useState(null);       // local value while dragging
  const [handoffOpen, setHandoffOpen] = useState(false);

  const goBack = () => { if (depth > 1) pop(); else window.history.back?.(); };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); goBack(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [depth, pop]);

  const isPlaying = PLAYING_STATES.has(snapshot.state);
  const duration = item?.duration ?? 0;
  const position = scrub ?? snapshot.position ?? 0;
  const commitSeek = () => {
    if (scrub != null) { transport.seekAbs?.(scrub); setScrub(null); }
  };

  return (
    <div data-testid="now-playing-view">
      <div className="now-playing-toolbar">
        <button data-testid="now-playing-back" className="now-playing-back-btn"
                onClick={goBack} aria-label="Back">← Back</button>
        <span className="now-playing-state" data-testid="np-state">{snapshot.state}</span>
      </div>

      <h2 className="now-playing-title">{item ? (item.title ?? item.contentId) : 'Nothing playing'}</h2>

      <div data-testid="now-playing-host" ref={hostRef} className="now-playing-host" />

      {item && (
        <div className="np-transport" data-testid="np-transport">
          <div className="np-seek-row">
            <span className="np-time">{fmt(position)}</span>
            <input
              data-testid="np-seek" className="np-seek" type="range"
              min="0" max={duration || 0} step="1"
              value={Math.min(position, duration || 0)}
              disabled={!duration}
              aria-label="Seek"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitSeek}
              onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') commitSeek(); }}
            />
            <span className="np-time">{duration ? fmt(duration) : '–:––'}</span>
          </div>
          <div className="np-buttons">
            <button data-testid="np-prev" aria-label="Previous" onClick={() => transport.skipPrev?.()}>⏮</button>
            <button data-testid="np-toggle" aria-label={isPlaying ? 'Pause' : 'Play'}
                    onClick={() => (isPlaying ? transport.pause?.() : transport.play?.())}>
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button data-testid="np-next" aria-label="Next" onClick={() => transport.skipNext?.()}>⏭</button>
            <button data-testid="np-stop" aria-label="Stop" onClick={() => transport.stop?.()}>■</button>
            <label className="np-volume-label">
              🔊
              <input data-testid="np-volume" type="range" min="0" max="100" step="1"
                     value={snapshot.config?.volume ?? 100}
                     aria-label="Volume"
                     onChange={(e) => config.setVolume?.(Number(e.target.value))} />
            </label>
          </div>
        </div>
      )}

      <QueuePanel target="local" />

      {item && (
        <div className="handoff-section" data-testid="handoff-section">
          <button data-testid="np-handoff-toggle" className="np-handoff-toggle"
                  onClick={() => setHandoffOpen((v) => !v)}>
            {handoffOpen ? 'Hide hand-off' : 'Hand off to device…'}
          </button>
          {handoffOpen && (
            <DispatchTargetPicker
              source={{ snapshot }}
              submitLabel="Hand off"
              autoFocus={false}
              onComplete={() => setHandoffOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
