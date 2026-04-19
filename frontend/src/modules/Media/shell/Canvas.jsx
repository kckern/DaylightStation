// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';
import { NowPlayingView } from './NowPlayingView.jsx';
import { HomeView } from '../browse/HomeView.jsx';
import { BrowseView } from '../browse/BrowseView.jsx';
import { DetailView } from '../browse/DetailView.jsx';
import { FleetView } from './FleetView.jsx';

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} modifiers={params.modifiers} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    case 'fleet': return <FleetView />;
    default: return <HomeView />;
  }
}

export function Canvas() {
  const { view, params } = useNav();
  return (
    <div data-testid="media-canvas" className="media-canvas">
      {renderView(view, params)}
    </div>
  );
}

export default Canvas;
