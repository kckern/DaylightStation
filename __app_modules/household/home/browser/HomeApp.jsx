import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import { IconCategory, IconHome, IconToggleRight, IconVideo } from '@tabler/icons-react';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, AppChrome, SectionCard, LoadingState, ErrorState, EmptyState,
} from '@/lib/ui';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import CameraFeed from "../../camera/browser/feed.mjs";
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import homeLogger from './homeLogger.js';
import { EntityDashboard } from './entities/EntityDashboard.jsx';
import { VIEWS } from './entities/groupEntities.js';
import './HomeApp.scss';

const logger = homeLogger;

const TAB_ICONS = { type: IconCategory, room: IconHome, state: IconToggleRight };
const TABS = [
  ...VIEWS.map((v) => {
    const Icon = TAB_ICONS[v.id];
    return { id: v.id, label: v.label, icon: <Icon size={20} stroke={1.75} aria-hidden="true" /> };
  }),
  { id: 'cameras', label: 'Cameras', icon: <IconVideo size={20} stroke={1.75} aria-hidden="true" /> },
];
const VIEW_KEY = 'home.view';

// The last view is a per-viewer convenience; storage may be unavailable.
function readSavedView() {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return TABS.some((t) => t.id === saved) ? saved : 'type';
  } catch { return 'type'; }
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
      <AppChrome title="Home" tabs={TABS} activeTab={view} onTabChange={changeView}>
        <div className="home-app__page">
          {view === 'cameras' ? <CameraGrid /> : <EntityDashboard view={view} />}
        </div>
      </AppChrome>
    </AppThemeProvider>
  );
}

export default HomeApp;
