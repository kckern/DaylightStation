import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { IconBolt, IconDoor, IconHome, IconList, IconVideo } from '@tabler/icons-react';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, SectionCard, LoadingState, ErrorState, EmptyState,
} from '@/lib/ui';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import CameraFeed from "../../camera/browser/feed.mjs";
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import homeLogger from './homeLogger.js';
import { useHomeEntities } from './entities/useHomeEntities.js';
import { NowView } from './now/NowView.jsx';
import { RoomsView } from './rooms/RoomsView.jsx';
import { PowerView } from './power/PowerView.jsx';
import { BrowseView } from './browse/BrowseView.jsx';
import './HomeApp.scss';

const logger = homeLogger;

const icon = (Icon) => <Icon size={20} stroke={1.75} aria-hidden="true" />;
const TABS = [
  { id: 'now', label: 'Now', icon: icon(IconHome) },
  { id: 'rooms', label: 'Rooms', icon: icon(IconDoor) },
  { id: 'power', label: 'Power', icon: icon(IconBolt) },
  { id: 'browse', label: 'Browse', icon: icon(IconList) },
  { id: 'cameras', label: 'Cameras', icon: icon(IconVideo) },
];
const VIEW_KEY = 'home.view';
// Views that lived under the old tab ids open where their content went.
const LEGACY_VIEWS = { type: 'browse', room: 'rooms', state: 'browse' };

// The last view is a per-viewer convenience; storage may be unavailable.
function readSavedView() {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    const view = LEGACY_VIEWS[saved] || saved;
    return TABS.some((t) => t.id === view) ? view : 'now';
  } catch { return 'now'; }
}
function saveView(view) {
  try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ }
}

const FullscreenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M1 1h5V0H0v6h1V1zm14 0h-5V0h6v6h-1V1zM1 15h5v1H0v-6h1v5zm14 0h-5v1h6v-6h-1v5z" />
  </svg>
);

// doorbell first, then alphabetical
function sortCameras(cameras) {
  return cameras.slice().sort((a, b) => {
    if (a.id === 'doorbell') return -1;
    if (b.id === 'doorbell') return 1;
    return a.id.localeCompare(b.id);
  });
}

// CameraFeed renders its own header wherever renderHeader is placed, but
// only exposes the fullscreen trigger through that callback — so we stash
// it in a ref and let SectionCard draw the actual header (title + action).
function CameraCard({ camId }) {
  const openViewportRef = useRef(() => {});
  return (
    <SectionCard
      title={camId}
      actions={(
        <ActionIcon
          aria-label={`Fullscreen ${camId}`}
          variant="subtle"
          size="sm"
          onClick={() => openViewportRef.current()}
        >
          <FullscreenIcon />
        </ActionIcon>
      )}
    >
      <CameraFeed
        cameraId={camId}
        renderHeader={(onFullscreen) => { openViewportRef.current = onFullscreen; return null; }}
      />
    </SectionCard>
  );
}

function CameraGrid() {
  const { data, loading, error, reload } = useApiResource('api/v1/camera', { label: 'cameras', logger });
  const cameras = useMemo(() => sortCameras(data?.cameras || []), [data]);
  if (loading) return <LoadingState label="cameras" rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Cameras" />;
  if (!cameras.length) {
    return <EmptyState title="No cameras configured" hint="Add a camera in devices.yml to see it here." />;
  }
  return (
    <div className="home-app__cameras">
      {cameras.map((cam) => <CameraCard key={cam.id} camId={cam.id} />)}
    </div>
  );
}

/** The four entity views share one polled reading of the house. */
function HouseViews({ view }) {
  const house = useHomeEntities();
  const { entities, rooms, types, stateClasses, haUrl, summary, fetchedAt, hasData, loading, error, reload, toggle, turnOff } = house;

  if (!hasData && loading) return <LoadingState label="the house" rows={6} />;
  // A failed poll keeps the last good reading on screen; only a first load
  // with nothing to show is a dead end.
  if (!hasData && error) return <ErrorState error={error} onRetry={reload} label="Home Assistant" />;

  const shared = { entities, rooms, types, haUrl, toggle };
  if (view === 'rooms') return <RoomsView {...shared} summary={summary} turnOff={turnOff} />;
  if (view === 'power') return <PowerView {...shared} summary={summary} />;
  if (view === 'browse') return <BrowseView {...shared} stateClasses={stateClasses} />;
  return <NowView {...shared} summary={summary} fetchedAt={fetchedAt} stale={Boolean(error)} turnOff={turnOff} />;
}

function HomeApp() {
  useDocumentTitle('Home');
  const [view, setView] = useState(readSavedView);

  useEffect(() => {
    logger.info('home.mount', { view });
    return () => logger.info('home.unmount', {});
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeView = (next) => {
    logger.debug('home.view.change', { from: view, to: next });
    setView(next);
    saveView(next);
  };

  return (
    <AppThemeProvider pack="home">
      <div className="home-app">
        <AppChrome title="Home" tabs={TABS} activeTab={view} onTabChange={changeView}>
          <div className="home-app__page">
            {view === 'cameras' ? <CameraGrid /> : <HouseViews view={view} />}
          </div>
        </AppChrome>
      </div>
    </AppThemeProvider>
  );
}

export default HomeApp;
