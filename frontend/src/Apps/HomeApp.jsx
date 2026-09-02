import { useMemo, useRef } from 'react';
import { ActionIcon } from '@mantine/core';
import '@mantine/core/styles.css';
import {
  AppThemeProvider, SectionCard, LoadingState, ErrorState, EmptyState, createAppLogger,
} from '@/lib/ui';
import { useApiResource } from '@/lib/hooks/useApiResource.js';
import CameraFeed from '../modules/CameraFeed/CameraFeed.jsx';
import useDocumentTitle from '../hooks/useDocumentTitle.js';

const logger = createAppLogger('home');

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

function HomeApp() {
  useDocumentTitle('Home');
  const { data, loading, error, reload } = useApiResource('api/v1/camera', { label: 'cameras', logger });
  const cameras = useMemo(() => sortCameras(data?.cameras || []), [data]);

  return (
    <AppThemeProvider pack="home">
      <div style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 600 }}>Home</h1>
        {loading ? <LoadingState label="cameras" rows={4} /> : null}
        {error ? <ErrorState error={error} onRetry={reload} label="Cameras" /> : null}
        {!loading && !error && !cameras.length ? (
          <EmptyState title="No cameras configured" hint="Add a camera in devices.yml to see it here." />
        ) : null}
        {!loading && !error && cameras.length ? (
          <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {cameras.map((cam) => <CameraCard key={cam.id} camId={cam.id} />)}
          </div>
        ) : null}
      </div>
    </AppThemeProvider>
  );
}

export default HomeApp;
