import React from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';

export function MediaAppShell() {
  return (
    <div className="media-app-shell">
      <Dock />
      <Canvas />
    </div>
  );
}

export default MediaAppShell;
