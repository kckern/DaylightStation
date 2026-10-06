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
import React, { useState, useCallback, useMemo } from 'react';
import { IconSearch } from '@tabler/icons-react';
import { MediaContentSearch } from '../search/MediaContentSearch.jsx';
import { FleetIndicator } from './FleetIndicator.jsx';
import { SettingsMenu } from './SettingsMenu.jsx';
import { StartFreshDialog } from './StartFreshDialog.jsx';
import { CastTargetChip } from '../cast/CastTargetChip.jsx';
import { FirstUseCard } from '../identity/FirstUseCard.jsx';
import { DestinationInteractionContext } from '../cast/destinationInteraction.js';

export function Dock({ onOpenSearch }) {
  const [startFreshOpen, setStartFreshOpen] = useState(false);
  const openStartFresh = useCallback(() => setStartFreshOpen(true), []);
  // Set while the destination control is being used, so an open search stays open.
  const [destinationActive, setDestinationActive] = useState(false);
  const destinationInteraction = useMemo(() => ({ active: destinationActive, setActive: setDestinationActive }), [destinationActive]);

  return (
    <DestinationInteractionContext.Provider value={destinationInteraction}>
    <header className="media-dock" data-testid="media-dock">
      {/* The destination control: where the next Play goes. On every width. The
          first-use naming popover anchors to it. */}
      <div className="media-dock-destination">
        <FirstUseCard><CastTargetChip /></FirstUseCard>
      </div>
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
      <SettingsMenu onResetSession={openStartFresh} />
      <StartFreshDialog open={startFreshOpen} onClose={() => setStartFreshOpen(false)} />
    </header>
    </DestinationInteractionContext.Provider>
  );
}

export default Dock;
