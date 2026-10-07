// frontend/src/modules/Media/shell/MediaAppShell.jsx
// The shell: persistent dock (top), primary nav (rail on tablet+/tabs on
// mobile), and a canvas showing exactly one view. Playback chrome (mini
// player, dispatch tray) docks between canvas and tab bar on mobile.
import React, { useCallback, useState } from 'react';
import { NavProvider, useNav } from './NavProvider.jsx';
import { DismissStackProvider } from './DismissStackProvider.jsx';
import { Dock } from './Dock.jsx';
import { NavRail, TabBar } from './PrimaryNav.jsx';
import { Canvas } from './Canvas.jsx';
import { MiniPlayer } from './MiniPlayer.jsx';
import { ScreenHandle } from './ScreenHandle.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import { SearchMode } from '../search/SearchMode.jsx';
import { ReconnectingNote } from './ReconnectingNote.jsx';
import { LocalPlaybackOutcomes } from './LocalPlaybackOutcomes.jsx';
import { RemoteScreenProblems } from './RemoteScreenProblems.jsx';
import { LocalStopFeedbackProvider, useLocalStopFeedbackCount } from './LocalStopFeedbackContext.jsx';
import { SearchLauncherContext } from './SearchLauncherContext.js';
import { slashIsNotForSearch } from './searchShortcut.js';
import mediaLog from '../logging/mediaLog.js';
import './MediaShell.scss';

function ShellInner() {
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

  // `/` focuses search from anywhere (unless already typing somewhere).
  React.useEffect(() => {
    const onKey = (e) => {
      if (slashIsNotForSearch(e)) return;
      // Tablet/laptop: the dock's search field. Phone: its field is hidden, so
      // the same key opens the full-screen search instead (NF-DEV-03).
      const input = document.querySelector('.media-dock .media-search-bar input');
      if (input && input.getClientRects().length > 0) { e.preventDefault(); input.focus(); return; }
      if (document.querySelector('[data-testid="media-search-launcher"]')?.getClientRects().length > 0) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <SearchLauncherContext.Provider value={searchLauncher}>
    <DismissStackProvider onBaseDismiss={baseDismiss}>
      <div className="media-shell" data-testid="media-shell">
        <Dock onOpenSearch={() => setSearchOpen(true)} />
        <div className="media-shell-body">
          <NavRail />
          <Canvas />
        </div>
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
        <TabBar />
        {searchOpen && <SearchMode addTo={searchAddTo} onClose={() => { setSearchOpen(false); setSearchAddTo(null); }} />}
      </div>
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
