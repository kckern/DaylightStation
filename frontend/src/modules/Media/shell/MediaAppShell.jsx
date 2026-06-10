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
import { MiniPlayer } from './MiniPlayer.jsx';
import { DispatchProgressTray } from '../cast/DispatchProgressTray.jsx';
import './MediaShell.scss';

function ShellInner() {
  const { pop, depth } = useNav();
  const baseDismiss = useCallback(() => {
    if (depth > 1) pop();
  }, [depth, pop]);

  // `/` focuses search from anywhere (unless already typing somewhere).
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.defaultPrevented) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const input = document.querySelector('[data-testid="media-search-input"]');
      if (input) { e.preventDefault(); input.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <DismissStackProvider onBaseDismiss={baseDismiss}>
      <div className="media-shell" data-testid="media-shell">
        <Dock />
        <div className="media-shell-body">
          <NavRail />
          <Canvas />
        </div>
        <DispatchProgressTray />
        <MiniPlayer />
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
