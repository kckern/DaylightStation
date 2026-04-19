// frontend/src/modules/Media/shell/MediaAppShell.jsx
import React, { useEffect, useState } from 'react';
import { Dock } from './Dock.jsx';
import { Canvas } from './Canvas.jsx';
import { NavProvider } from './NavProvider.jsx';
import { useClientIdentity } from '../session/ClientIdentityProvider.jsx';

function StationHeader() {
  const { displayName, clientId } = useClientIdentity();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString([], { hour12: false });

  return (
    <header className="media-station-header">
      <div className="station-brand">
        <span className="station-brand__dot" aria-hidden="true" />
        <span className="station-brand__wordmark">
          <span className="station-brand__wordmark-primary">Homeline</span>
          <span className="station-brand__wordmark-secondary">Media Console · ƒ/01</span>
        </span>
      </div>
      <div className="station-meta">
        <span className="station-meta__item">
          <span className="station-meta__label">Client</span>
          <span className="station-meta__value" title={clientId}>{displayName}</span>
        </span>
        <span className="station-meta__divider" aria-hidden="true" />
        <span className="station-meta__item">
          <span className="station-meta__label">Local time</span>
          <span className="station-meta__value station-meta__value--mono">{time}</span>
        </span>
      </div>
    </header>
  );
}

export function MediaAppShell() {
  return (
    <NavProvider>
      <div className="media-app-shell">
        <StationHeader />
        <Dock />
        <Canvas />
      </div>
    </NavProvider>
  );
}

export default MediaAppShell;
