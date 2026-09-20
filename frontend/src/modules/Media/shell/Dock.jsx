// frontend/src/modules/Media/shell/Dock.jsx
// Tablet+: the persistent row — search, fleet indicator, cast target chip,
// settings. Mobile: a launcher only. A 360px dock used to split the row
// between a scope control, a search input, and a 168px icon cluster; the
// input landed at ~50px (its own placeholder didn't fit) and a CSS rule hid
// the scope control at the one moment it mattered (focus). Mobile now gets
// none of that contention — tapping the launcher opens the full-screen
// Search Mode surface (SearchMode.jsx, Task 13), which owns the whole
// screen for search + scope + destination instead of a shared row. The
// fleet indicator and cast chip are desktop-only now too (both
// tablet-up-gated in MediaShell.scss); the fleet signal mobile still needs
// moved to a badge on the Devices tab (PrimaryNav.jsx) instead. The settings
// gear is the one control both layouts keep, so it renders once, unscoped.
import React, { useState, useCallback } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { MediaContentSearch } from '../search/MediaContentSearch.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { SettingsMenu } from './SettingsMenu.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { useCastTarget } from '../cast/useCastTarget.js';
import { useSessionController } from '../controller/useSessionController.js';

export function Dock({ onOpenSearch }) {
  const { lifecycle } = useSessionController('local');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [returnAimLocal, setReturnAimLocal] = useState(true);
  const { clearTargets } = useCastTarget();

  const doReset = useCallback(() => {
    setConfirmOpen(false);
    lifecycle.reset?.();
    if (returnAimLocal) clearTargets();
  }, [clearTargets, lifecycle, returnAimLocal]);

  const openStartFresh = useCallback(() => {
    setReturnAimLocal(true);
    setConfirmOpen(true);
  }, []);

  return (
    <header className="media-dock" data-testid="media-dock">
      <button
        type="button"
        className="media-search-launcher"
        data-testid="media-search-launcher"
        onClick={() => onOpenSearch?.()}
      >
        <IconSearch size={18} aria-hidden="true" />
        <span>Search media…</span>
      </button>
      {/* No wrapper div: MediaContentSearch's own root, `.media-search-bar`,
          must stay a DIRECT flex child of `.media-dock` — it carries
          `flex: 1` itself (MediaShell.scss), and a wrapper wraps it in an
          unstyled block box instead, orphaning that `flex: 1` and collapsing
          the bar to its content width on desktop (measured 560px -> 205px
          at 1200px before this fix). Mobile hides `.media-search-bar`
          directly by its own class (mobile-only rule below), not via a
          wrapper. */}
      <MediaContentSearch />
      <FleetIndicator />
      <div className="media-dock-cluster"><CastTargetChip /></div>
      <SettingsMenu onResetSession={openStartFresh} />
      <ConfirmDialog
        open={confirmOpen}
        title="Start fresh on this device?"
        message="This clears this device’s current queue and playback position. It does not stop anything playing on other screens."
        confirmLabel="Start fresh"
        cancelLabel="Cancel"
        onConfirm={doReset}
        onCancel={() => setConfirmOpen(false)}
      >
        <label>
          <input
            type="checkbox"
            checked={returnAimLocal}
            onChange={(event) => setReturnAimLocal(event.target.checked)}
          />
          Return aim to this device
        </label>
      </ConfirmDialog>
    </header>
  );
}

export default Dock;
