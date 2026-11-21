// frontend/src/modules/Media/shell/Canvas.jsx
import React from 'react';
import { useNav } from "./NavProvider.jsx";
import { HomeView } from "../browse/HomeView.jsx";
import { BrowseView } from "../browse/BrowseView.jsx";
import { DetailView } from "../browse/DetailView.jsx";
import { NowPlayingView } from "./NowPlayingView.jsx";
import { FleetView } from "./FleetView.jsx";
import { PeekPanel } from "./PeekPanel.jsx";
import { ScreenAdminView } from "../house/ScreenAdminView.jsx";
import { RoutineHistoryView } from "../house/RoutineHistoryView.jsx";

function renderView(view, params, destinationControlRef) {
  switch (view) {
    case 'home': return <HomeView />;
    case 'browse': return <BrowseView path={params.path ?? ''} label={params.label} containerItem={params.containerItem ?? null}
      breadcrumbs={params.breadcrumbs ?? []} scrollTop={params.scrollTop ?? 0} focusedId={params.focusedId ?? null}
      loadedCount={params.loadedCount ?? 0} />;
    case 'detail': return <DetailView key={params.contentId} contentId={params.contentId} />;
    case 'nowPlaying': return <NowPlayingView destinationControlRef={destinationControlRef} />;
    case 'fleet': return <FleetView />;
    case 'peek': return <PeekPanel deviceId={params.deviceId} />;
    case 'screens': return <ScreenAdminView />;
    case 'routines': return <RoutineHistoryView />;
    default: return <HomeView />;
  }
}

export function Canvas({ destinationControlRef }) {
  const { view, params } = useNav();
  return (
    <main data-testid="media-canvas" className="media-canvas">
      {renderView(view, params, destinationControlRef)}
    </main>
  );
}

export default Canvas;
