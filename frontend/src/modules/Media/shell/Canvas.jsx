// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';
import { HomeView } from '../browse/HomeView.jsx';
import { BrowseView } from '../browse/BrowseView.jsx';
import { DetailView } from '../browse/DetailView.jsx';
import { NowPlayingView } from './NowPlayingView.jsx';
import { FleetView } from './FleetView.jsx';
import { PeekPanel } from './PeekPanel.jsx';

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} label={params.label} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    case 'fleet': return <FleetView />;
    case 'peek': return <PeekPanel deviceId={params.deviceId} />;
    default: return <HomeView />;
  }
}

export function Canvas() {
  const { view, params } = useNav();
  return (
    <main data-testid="media-canvas" className="media-canvas">
      {renderView(view, params)}
    </main>
  );
}

export default Canvas;
