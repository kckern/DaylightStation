import { browserPreference } from '@/lib/browserPreference.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { IconDoor, IconLayoutGrid, IconTimeline, IconVideo } from '@tabler/icons-react';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, DismissStackProvider, SectionCard, LoadingState, ErrorState, EmptyState,
  useViewScroll,
} from '@/lib/ui';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import CameraFeed from "../../camera/browser/feed.mjs";
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import homeLogger from './homeLogger.js';
import { useHomeEntities } from './entities/useHomeEntities.js';
import { TodayView } from './today/TodayView.jsx';
import { MosaicView } from './mosaic/MosaicView.jsx';
import { RoomsView } from './rooms/RoomsView.jsx';
import './HomeApp.scss';

const logger = homeLogger;

const icon = (Icon) => <Icon size={20} stroke={1.75} aria-hidden="true" />;
const TABS = [
  { id: 'today', label: 'Today', icon: icon(IconTimeline) },
  { id: 'mosaic', label: 'Mosaic', icon: icon(IconLayoutGrid) },
  { id: 'rooms', label: 'Rooms', icon: icon(IconDoor) },
  { id: 'cameras', label: 'Cameras', icon: icon(IconVideo) },
];
const VIEW_KEY = 'home.view';
// Views that lived under the old tab ids open where their content went.
const LEGACY_VIEWS = { now: 'today', browse: 'mosaic', power: 'today', type: 'mosaic', room: 'rooms', state: 'mosaic' };

const viewPreference = browserPreference(VIEW_KEY, 'today', saved => {
  const view = LEGACY_VIEWS[saved] || saved;
  return TABS.some(tab => tab.id === view) ? view : 'today';
});

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
          className="ds-touch-target"
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

function CameraGrid({ contentRef }) {
  const { data, loading, error, reload } = useApiResource('api/v1/camera', { label: 'cameras', logger });
  const cameras = useMemo(() => sortCameras(data?.cameras || []), [data]);
  if (loading) return <LoadingState label="cameras" rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Cameras" />;
  if (!cameras.length) {
    return <EmptyState title="No cameras configured" hint="Add a camera in devices.yml to see it here." />;
  }
  return (
    <div ref={contentRef} className="home-app__cameras">
      {cameras.map((cam) => <CameraCard key={cam.id} camId={cam.id} />)}
    </div>
  );
}

function HomeView({ view, house }) {
  const { entities, rooms, types, mosaic, haUrl, summary, hasData, loading, error, reload, toggle, turnOff } = house;

  if (!hasData && loading) return <LoadingState label="the house" rows={6} />;
  // A failed poll keeps the last good reading on screen; only a first load
  // with nothing to show is a dead end.
  if (!hasData && error) return <ErrorState error={error} onRetry={reload} label="Home Assistant" />;

  const shared = { entities, rooms, haUrl, toggle };
  if (view === 'rooms') return <RoomsView {...shared} types={types} summary={summary} turnOff={turnOff} />;
  if (view === 'mosaic') return <MosaicView {...shared} mosaic={mosaic} summary={summary} />;
  return <TodayView {...shared} summary={summary} />;
}

function HomeApp() {
  useDocumentTitle('Home');
  const [view, setView] = useState(viewPreference.read);
  const mainRef = useRef(null);
  const [cameraGrid, setCameraGrid] = useState(null);
  const showCameras = view === 'cameras';
  const house = useHomeEntities({ active: !showCameras });
  useViewScroll({ mainRef, viewKey: view, ready: showCameras ? Boolean(cameraGrid) : house.hasData });

  useEffect(() => {
    logger.info('home.mount', { view });
    return () => logger.info('home.unmount', {});
    // mount/unmount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeView = (next) => {
    logger.debug('home.view.change', { from: view, to: next });
    setView(next);
    viewPreference.write(next);
  };

  return (
    <AppThemeProvider pack="home">
      {/* One Escape handler for the app: it closes the topmost drawer. */}
      <DismissStackProvider>
        <div className="home-app">
          <AppChrome title="Home" tabs={TABS} activeTab={view} onTabChange={changeView} mainRef={mainRef}>
            <div className="home-app__page">
              {showCameras ? <CameraGrid contentRef={setCameraGrid} /> : <HomeView view={view} house={house} />}
            </div>
          </AppChrome>
        </div>
      </DismissStackProvider>
    </AppThemeProvider>
  );
}

export default HomeApp;
