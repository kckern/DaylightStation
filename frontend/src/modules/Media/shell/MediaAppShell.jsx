import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';
import { AppNav } from './AppNav.jsx';
import { NavProvider } from './NavProvider.jsx';

export function MediaAppShell() {
  return (
    <NavProvider>
      <div className="media-app-shell">
        <Dock />
        <div className="media-app-body">
          <AppNav />
          <Canvas />
        </div>
      </div>
    </NavProvider>
  );
}

export default MediaAppShell;
