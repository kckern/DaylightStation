import React, { useRef, useState, useEffect } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useHandOff } from '../cast/useHandOff.js';
import { useNav } from './NavProvider.jsx';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { devices } = useFleetContext();
  const handOff = useHandOff();
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState('transfer');
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

  const onHandOff = () => {
    if (!targetId) return;
    handOff(targetId, { mode });
  };

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
      {item && devices.length > 0 && (
        <div data-testid="handoff-section" className="handoff-section">
          <select
            data-testid="handoff-target"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">Hand off to…</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name ?? d.id}</option>
            ))}
          </select>
          <label>
            <input
              type="radio"
              name="handoff-mode"
              checked={mode === 'transfer'}
              onChange={() => setMode('transfer')}
              data-testid="handoff-mode-transfer"
            />
            Transfer
          </label>
          <label>
            <input
              type="radio"
              name="handoff-mode"
              checked={mode === 'fork'}
              onChange={() => setMode('fork')}
              data-testid="handoff-mode-fork"
            />
            Fork
          </label>
          <button
            data-testid="handoff-submit"
            onClick={onHandOff}
            disabled={!targetId}
          >
            Hand Off
          </button>
        </div>
      )}
    </div>
  );
}

export default NowPlayingView;
