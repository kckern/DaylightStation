import React from 'react';
import { useCastTarget } from './useCastTarget.js';
import { useFleetContext } from '../fleet/FleetProvider.jsx';

export function CastPopover() {
  const { mode, targetIds, setMode, toggleTarget } = useCastTarget();
  const { devices } = useFleetContext();

  return (
    <div data-testid="cast-popover" className="cast-popover">
      <div className="cast-popover-section">
        <div className="cast-popover-label">Mode</div>
        <label>
          <input
            type="radio"
            name="cast-mode"
            checked={mode === 'transfer'}
            onChange={() => setMode('transfer')}
            data-testid="cast-mode-transfer"
          />
          Transfer (stop local)
        </label>
        <label>
          <input
            type="radio"
            name="cast-mode"
            checked={mode === 'fork'}
            onChange={() => setMode('fork')}
            data-testid="cast-mode-fork"
          />
          Fork (keep local)
        </label>
      </div>
      <div className="cast-popover-section">
        <div className="cast-popover-label">Targets</div>
        {devices.length === 0 && <div>No devices</div>}
        {devices.map((d) => (
          <label key={d.id}>
            <input
              type="checkbox"
              checked={targetIds.includes(d.id)}
              onChange={() => toggleTarget(d.id)}
              data-testid={`cast-target-checkbox-${d.id}`}
            />
            {d.name ?? d.id}
          </label>
        ))}
      </div>
    </div>
  );
}

export default CastPopover;
