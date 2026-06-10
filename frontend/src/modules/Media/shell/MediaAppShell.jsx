// frontend/src/modules/Media/shell/MediaAppShell.jsx
// The shell: persistent dock (top), primary nav (rail on tablet+/tabs on
// mobile), and a canvas showing exactly one view. Playback chrome (mini
// player, dispatch tray) docks between canvas and tab bar on mobile.
import React, { useCallback } from 'react';
import { NavProvider, useNav } from './NavProvider.jsx';
import { DismissStackProvider } from './DismissStackProvider.jsx';
import { Dock } from './Dock.jsx';
import { NavRail, TabBar } from './PrimaryNav.jsx';
import { Canvas } from './Canvas.jsx';
import './MediaShell.scss';

function ShellInner() {
  const { pop, depth } = useNav();
  const baseDismiss = useCallback(() => {
    if (depth > 1) pop();
  }, [depth, pop]);

  return (
    <DismissStackProvider onBaseDismiss={baseDismiss}>
      <div className="media-shell" data-testid="media-shell">
        <Dock />
        <div className="media-shell-body">
          <NavRail />
          <Canvas />
        </div>
        {/* dispatch tray strip + mini player mount here (Phases 2/6) */}
        <TabBar />
      </div>
    </DismissStackProvider>
  );
}

export function MediaAppShell() {
  return (
    <NavProvider>
      <ShellInner />
    </NavProvider>
  );
}

export default MediaAppShell;
