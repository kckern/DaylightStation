// frontend/src/modules/Media/shell/NowPlayingView.jsx
import React, { useRef, useState } from 'react';
import { useSessionController } from '../session/useSessionController.js';
import { usePlayerHost } from '../session/usePlayerHost.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';
import { useHandOff } from '../cast/useHandOff.js';

export function NowPlayingView() {
  const { snapshot } = useSessionController('local');
  const item = snapshot.currentItem;
  const hostRef = useRef(null);
  usePlayerHost(hostRef);
  const { devices } = useFleetContext();
  const handOff = useHandOff();
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState('transfer');

  const onHandOff = () => {
    if (!targetId) return;
    handOff(targetId, { mode });
  };

  return (
    <div data-testid="now-playing-view">
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
