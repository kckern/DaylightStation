import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, SegmentedControl } from '@mantine/core';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, SectionCard, LoadingState, ErrorState, EmptyState,
} from '@/lib/ui';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import CameraFeed from "../../camera/browser/feed.mjs";
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import homeLogger from './homeLogger.js';
import { EntityDashboard } from './entities/EntityDashboard.jsx';
import { VIEWS } from './entities/groupEntities.js';

const logger = homeLogger;

const TABS = [...VIEWS.map((v) => ({ value: v.id, label: v.label })), { value: 'cameras', label: 'Cameras' }];
const VIEW_KEY = 'home.view';

// The last view is a per-viewer convenience; storage may be unavailable.
function readSavedView() {
  try {
    const saved = window.localStorage.getItem(VIEW_KEY);
    return TABS.some((t) => t.value === saved) ? saved : 'type';
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
    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))' }}>
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
      <div style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Home</h1>
          <SegmentedControl value={view} onChange={changeView} data={TABS} aria-label="Home view" />
        </div>
        {view === 'cameras' ? <CameraGrid /> : <EntityDashboard view={view} />}
      </div>
    </AppThemeProvider>
  );
}

export default HomeApp;
