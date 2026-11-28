// frontend/src/modules/Media/shell/Dock.jsx
// Tablet+: the persistent row — search (with the destination chip inside the
// box: where ▶ plays, Tab cycles it — search/DestinationChip.jsx), fleet
// indicator, settings. One destination, shown where you type, on every
// width: the phone's launcher box carries the same chip + ▾ at its right end
// (the old header "Playing on" control is gone). Mobile: a launcher only. A 360px dock used to split the row
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
import { UiIcon } from '../../../../../frontend/src/lib/ui/UiIcon.jsx';
import React, { useState, useCallback, useMemo } from 'react';
import { useCompactViewport } from '@/lib/ui/useCompactViewport.js';
import { MediaContentSearch } from "../search/MediaContentSearch.jsx";
import { FleetIndicator } from "./FleetIndicator.jsx";
import { SettingsMenu } from "./SettingsMenu.jsx";
import { StartFreshDialog } from "./StartFreshDialog.jsx";
import { UnstyledButton } from '@mantine/core';
import { DestinationChip } from "../search/DestinationChip.jsx";
import { FirstUseCard } from "../identity/FirstUseCard.jsx";
import { DestinationInteractionContext } from "../cast/destinationInteraction.js";

export function Dock({ onOpenSearch, searchInputRef, launcherRef, destinationControlRef }) {
  const [startFreshOpen, setStartFreshOpen] = useState(false);
  const openStartFresh = useCallback(() => setStartFreshOpen(true), []);
  // Set while the destination control is being used, so an open search stays open.
  const [destinationActive, setDestinationActive] = useState(false);
  const destinationInteraction = useMemo(() => ({ active: destinationActive, setActive: setDestinationActive }), [destinationActive]);
  const isPhone = useCompactViewport();

  return (
    <DestinationInteractionContext.Provider value={destinationInteraction}>
    <header className="media-dock" data-testid="media-dock">
      {/* Phone: the launcher looks like the search box it opens, with the
          destination chip (and its ▾ list) at its right end — the same chip
          the desktop box and the phone search sheet carry. The first-use
          naming popover anchors to it. */}
      <div className="media-search-launcher" data-testid="media-search-launcher-row">
        <UnstyledButton
          ref={launcherRef}
          className="media-search-launcher-open"
          data-testid="media-search-launcher"
          onClick={() => onOpenSearch?.()}
        >
          <UiIcon name="search" size={18} />
          <span>Search media…</span>
        </UnstyledButton>
        {isPhone && (
          <FirstUseCard><DestinationChip compact controlRef={destinationControlRef} /></FirstUseCard>
        )}
      </div>
      {/* No wrapper div: MediaContentSearch's own root, `.media-search-bar`,
          must stay a DIRECT flex child of `.media-dock` — it carries
          `flex: 1` itself (MediaShell.scss), and a wrapper wraps it in an
          unstyled block box instead, orphaning that `flex: 1` and collapsing
          the bar to its content width on desktop (measured 560px -> 205px
          at 1200px before this fix). Mobile hides `.media-search-bar`
          directly by its own class (mobile-only rule below), not via a
          wrapper. */}
      <MediaContentSearch inputRef={searchInputRef} destinationWrapper={isPhone ? null : FirstUseCard} destinationControlRef={isPhone ? null : destinationControlRef} />
      <FleetIndicator />
      <SettingsMenu onResetSession={openStartFresh} />
      <StartFreshDialog open={startFreshOpen} onClose={() => setStartFreshOpen(false)} />
    </header>
    </DestinationInteractionContext.Provider>
  );
}

export default Dock;
