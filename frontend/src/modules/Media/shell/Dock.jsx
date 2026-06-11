// frontend/src/modules/Media/shell/Dock.jsx
// The app's constant: search (always one keystroke away), fleet indicator,
// cast target chip, settings. The mini player is the bottom bar (MediaShell).
import React, { useState, useCallback } from 'react';
import { SearchBar } from '../search/SearchBar.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { SettingsMenu } from './SettingsMenu.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { useSessionController } from '../controller/useSessionController.js';

export function Dock() {
  const { lifecycle } = useSessionController('local');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doReset = useCallback(() => {
    setConfirmOpen(false);
    lifecycle.reset?.();
  }, [lifecycle]);

  return (
    <header className="media-dock" data-testid="media-dock">
      <SearchBar />
      <div className="media-dock-cluster">
        <FleetIndicator />
        <CastTargetChip />
        <SettingsMenu onResetSession={() => setConfirmOpen(true)} />
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Reset local session?"
        message="This clears the current queue and playback position. This cannot be undone."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={doReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </header>
  );
}

export default Dock;
