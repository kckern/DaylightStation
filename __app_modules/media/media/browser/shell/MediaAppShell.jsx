// frontend/src/modules/Media/shell/MediaAppShell.jsx
// The shell: persistent dock (top), primary nav (rail on tablet+/tabs on
// mobile), and a canvas showing exactly one view. Playback chrome (mini
// player, dispatch tray) docks between canvas and tab bar on mobile.
import { PlaybackFrame } from '@/lib/ui/AppFrame.jsx';
import { useHotkey } from '@/lib/hooks/useHotkey.js';
import React, { useCallback, useRef, useState } from 'react';
import { NavProvider, useNav } from "./NavProvider.jsx";
import { DismissStackProvider } from "@/lib/ui/dismiss/DismissStackProvider.jsx";
import { Dock } from "./Dock.jsx";
import { NavRail, TabBar } from "./PrimaryNav.jsx";
import { Canvas } from "./Canvas.jsx";
import { MiniPlayer } from "./MiniPlayer.jsx";
import { ScreenHandle } from "./ScreenHandle.jsx";
import { DispatchProgressTray } from "../cast/DispatchProgressTray.jsx";
import { SearchMode } from "../search/SearchMode.jsx";
import { ReconnectingNote } from "./ReconnectingNote.jsx";
import { LocalPlaybackOutcomes } from "./LocalPlaybackOutcomes.jsx";
import { RemoteScreenProblems } from "./RemoteScreenProblems.jsx";
import { LocalStopFeedbackProvider, useLocalStopFeedbackCount } from "./LocalStopFeedbackContext.jsx";
import { SearchLauncherContext } from "./SearchLauncherContext.js";
import { PlaybackQualityHost } from "../quality/PlaybackQualityProvider.jsx";
import mediaLog from "../logging/mediaLog.js";
import "./MediaShell.scss";

function ShellInner() {
  const searchInputRef = React.useRef(null);
  const launcherRef = React.useRef(null);
  const destinationControlRef = useRef(null);
  const restoreSearchFocus = useCallback(() => {
    const target = searchInputRef.current?.getClientRects().length ? searchInputRef.current : launcherRef.current;
    target?.focus({ preventScroll: true });
  }, []);
  const { pop, depth } = useNav();
  const [searchOpen, setSearchOpen] = useState(false);
  // Add to this queue: the one search, for one addition to one screen.
  const [searchAddTo, setSearchAddTo] = useState(null);
  const searchLauncher = React.useMemo(() => ({
    // The phone tab bar's Search: the one search, at the thumb (RELY.12a).
    openSearch: () => { setSearchAddTo(null); setSearchOpen(true); },
    openAddToQueue: ({ deviceId, name = null }) => {
      if (typeof deviceId !== 'string' || !deviceId) return;
      mediaLog.addToQueueOpened({ deviceId });
      setSearchAddTo({ deviceId, name });
      setSearchOpen(true);
    },
  }), []);
  const queueKeptCount = useLocalStopFeedbackCount();
  const baseDismiss = useCallback(() => {
    if (depth > 1) pop();
  }, [depth, pop]);

  useHotkey('/', () => {
    if (searchOpen) return false;
    // Desktop uses the dock input. On phones the launcher opens a sheet.
    const input = searchInputRef.current;
    if (input?.getClientRects().length) input.focus();
    else if (launcherRef.current?.getClientRects().length) searchLauncher.openSearch();
    else return false;
  });

  return (
    <SearchLauncherContext.Provider value={searchLauncher}>
    <DismissStackProvider onBaseDismiss={baseDismiss}>
      <PlaybackFrame className="media-shell" data-testid="media-shell"
        header={<Dock searchInputRef={searchInputRef} launcherRef={launcherRef} destinationControlRef={destinationControlRef} onOpenSearch={() => setSearchOpen(true)} />}
        controls={<>
          <ReconnectingNote />
          <LocalPlaybackOutcomes />
          <RemoteScreenProblems />
          {/* Outcome notices float over the canvas: a zero-height anchor sits
              directly above the mini player (or tab bar), so a row appearing
              never takes page space or moves anything, and never covers the
              handle's controls. Only the row's own buttons take pointer input. */}
          <div className="media-outcome-anchor" data-testid="media-outcome-anchor">
            <DispatchProgressTray />
          </div>
          <ScreenHandle />
          <MiniPlayer />
          {queueKeptCount != null && (
            <div className="np-queue-kept" data-testid="np-queue-kept" role="status">
              Queue kept: {queueKeptCount} item{queueKeptCount === 1 ? '' : 's'}
            </div>
          )}
        </>}
        navigation={<TabBar />}
        overlays={<>
          <PlaybackQualityHost />
          {searchOpen && <SearchMode restoreSearchFocus={restoreSearchFocus} addTo={searchAddTo} onClose={() => { setSearchOpen(false); setSearchAddTo(null); }} />}
        </>}
      >
        <div className="media-shell-body">
          <NavRail />
          <Canvas destinationControlRef={destinationControlRef} />
        </div>
      </PlaybackFrame>
    </DismissStackProvider>
    </SearchLauncherContext.Provider>
  );
}

export function MediaAppShell() {
  return (
    <NavProvider>
      <LocalStopFeedbackProvider>
        <ShellInner />
      </LocalStopFeedbackProvider>
    </NavProvider>
  );
}

export default MediaAppShell;
