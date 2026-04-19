import React from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  return (
    <div data-testid="media-dock">
      <SearchBar />
      <FleetIndicator />
      <MiniPlayer />
      <button data-testid="session-reset-btn" onClick={lifecycle.reset}>Reset session</button>
    </div>
  );
}

export default Dock;
