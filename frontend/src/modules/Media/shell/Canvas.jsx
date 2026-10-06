// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from './NavProvider.jsx';
import { HomeView } from '../browse/HomeView.jsx';
import { BrowseView } from '../browse/BrowseView.jsx';
import { DetailView } from '../browse/DetailView.jsx';
import { NowPlayingView } from './NowPlayingView.jsx';
import { FleetView } from './FleetView.jsx';
import { PeekPanel } from './PeekPanel.jsx';
import { ScreenAdminView } from '../house/ScreenAdminView.jsx';
import { RoutineHistoryView } from '../house/RoutineHistoryView.jsx';
import { FirstUseCard } from '../identity/FirstUseCard.jsx';

function renderView(view, params) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} label={params.label} containerItem={params.containerItem ?? null}
      breadcrumbs={params.breadcrumbs ?? []} scrollTop={params.scrollTop ?? 0} focusedId={params.focusedId ?? null}
      loadedCount={params.loadedCount ?? 0} />;
    case 'detail': return <DetailView contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView />;
    case 'fleet': return <FleetView />;
    case 'peek': return <PeekPanel deviceId={params.deviceId} />;
    case 'screens': return <ScreenAdminView />;
    case 'routines': return <RoutineHistoryView />;
    default: return <HomeView />;
  }
}

export function Canvas() {
  const { view, params } = useNav();
  return (
    <main data-testid="media-canvas" className="media-canvas">
      {/* RQ-RELY-12: the first-use moment, until this device is named or it is skipped. */}
      {view === 'home' && <FirstUseCard />}
      {renderView(view, params)}
    </main>
  );
}

export default Canvas;
