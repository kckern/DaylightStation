import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock" className="media-dock">
      <div className="dock-region dock-region--search">
        <span className="dock-region__label">01 · Find</span>
        <div className="dock-region__stack">
          <SearchBar />
        </div>
      </div>

      <div className="dock-region dock-region--fleet">
        <span className="dock-region__label">02 · Fleet</span>
        <div className="dock-region__stack">
          <FleetIndicator />
          <CastTargetChip />
        </div>
      </div>

      <div className="dock-region dock-region--transport">
        <span className="dock-region__label">03 · Transport</span>
        <div className="dock-region__stack">
          <MiniPlayer />
        </div>
      </div>

      <button
        data-testid="session-reset-btn"
        className="session-reset-btn"
        onClick={lifecycle.reset}
        title="Reset local session"
      >
        <span className="session-reset-btn__label">Reset</span>
        <span className="session-reset-btn__icon" aria-hidden="true">↻</span>
      </button>

      <DispatchProgressTray />
    </div>
  );
}

export default Dock;
