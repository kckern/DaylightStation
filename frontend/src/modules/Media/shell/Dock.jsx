import React, { useState, useCallback } from 'react';
import { MiniPlayer } from './MiniPlayer.jsx';
import { useSessionController } from '../session/useSessionController.js';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doReset = useCallback(() => {
    setConfirmOpen(false);
    lifecycle.reset();
  }, [lifecycle]);

  return (
    <div data-testid="media-dock">
      <SearchBar />
      <FleetIndicator />
      <CastTargetChip />
      <MiniPlayer />
      <DispatchProgressTray />
      <button data-testid="session-reset-btn" onClick={() => setConfirmOpen(true)}>
        Reset session
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset local session?"
        message="This clears the current queue and playback position. This cannot be undone."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={doReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default Dock;
