// frontend/src/modules/Media/shell/MediaAppShell.jsx
import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';
import { NavProvider } from './NavProvider.jsx';

export function MediaAppShell() {
  return (
    <NavProvider>
      <div className="media-app-shell">
        <Dock />
        <Canvas />
      </div>
    </NavProvider>
  );
}

export default MediaAppShell;
