import { browserPreference } from '../../../lib/browserPreference.js';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NativeSelect } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { EmptyState, ErrorState, StateMessage } from '../../../lib/ui/states.jsx';
import { Player as Player } from "../../../../../__app_modules/media/media/browser/playback.mjs";
import { previewFrameVars } from './previewFrame.js';
import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';
import getLogger from '../../../lib/logging/Logger.js';
import './AdminPreviewPlayer.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'admin-preview-player' });
  return _logger;
}

const screenPreference = browserPreference('daylight.adminPreview.screenId', null, id => id || null);

export default function AdminPreviewPlayer({ contentId, action, volume, playbackRate, shuffle, onClose }) {
  const isQueue = action === 'Queue';
  const queuePath = isQueue && contentId ? `api/v1/queue/${contentId}${shuffle ? '?shuffle=true' : ''}` : null;
  const queue = useApiResource(queuePath, { retryTransient: false, label: 'Preview queue' });
  const queueItems = queue.data?.items;
  const [selection, setSelection] = useState(null);
  const currentIndex = selection?.path === queuePath ? selection.index : 0;
  const activeRef = useRef(null);
  const { ref: previewRef, width: previewWidth } = useElementSize();

  // Which real screen this preview is imitating. The Player is sized entirely
  // in rem, so the ONLY thing that makes the preview match the kiosk is laying
  // out in the same number of CSS px the kiosk has.
  const { screens } = usePreviewScreens();
  const [screenId, setScreenId] = useState(screenPreference.read);

  const activeScreen = useMemo(
    () => screens.find((s) => s.id === screenId) || screens[0] || FALLBACK_SCREEN,
    [screens, screenId]
  );

  // A stored id for a screen that has since been renamed or removed silently
  // resolves to a DIFFERENT screen — the UI stays self-consistent, so the only
  // tell is that you are previewing at a size you did not pick. Say so once the
  // real list has arrived (never against the in-flight fallback, which legitimately
  // does not contain the stored id yet).
  const resolvedAwayFromStored = screenId
    && screens.length > 0
    && screens[0].id !== FALLBACK_SCREEN.id
    && !screens.some((s) => s.id === screenId);
  useEffect(() => {
    if (resolvedAwayFromStored) {
      logger().warn('stored-screen-missing', { storedId: screenId, using: activeScreen.id });
    }
  }, [resolvedAwayFromStored, screenId, activeScreen.id]);

  const frameVars = useMemo(() => {
    const vars = previewFrameVars(activeScreen.resolution, previewWidth);
    if (vars) return vars;
    // Unreachable today: usePreviewScreens filters every entry through the same
    // predicate previewFrameVars guards with, and FALLBACK_SCREEN is frozen and
    // previewable. Kept because the property making it unreachable lives in
    // ANOTHER module — and because a null style prop is dropped by React, handing
    // the frame to the SCSS defaults with no error and no visual tell, which is
    // the exact bug class this whole change exists to remove. So: never silent.
    logger().warn('frame-vars-fallback', { screenId: activeScreen.id, resolution: activeScreen.resolution });
    return previewFrameVars(FALLBACK_SCREEN.resolution, previewWidth);
  }, [activeScreen, previewWidth]);

  const handleScreenChange = useCallback((event) => {
    const id = event.currentTarget.value;
    logger().debug('screen-changed', { screenId: id });
    setScreenId(id);
    screenPreference.write(id);
  }, []);

  // Auto-scroll active item into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex]);

  // Memoised so the option list is not rebuilt on every queue-index change.
  const screenPicker = useMemo(() => (
    <NativeSelect
      size="xs"
      w={220}
      maw="100%"
      label="Preview at screen"
      value={activeScreen.id}
      onChange={handleScreenChange}
      data={screens.map((s) => ({
        value: s.id,
        label: `${s.name} — ${s.resolution.width}x${s.resolution.height}`,
      }))}
    />
  ), [screens, activeScreen.id, handleScreenChange]);

  const mediaConfig = useMemo(() => ({ contentId, volume, playbackRate }), [contentId, volume, playbackRate]);
  const currentSlice = useMemo(() => queueItems?.slice(currentIndex), [queueItems, currentIndex]);

  let status = null;
  if (isQueue) {
    if (queue.loading) status = <StateMessage state="loading" role="status" title="Loading queue..." />;
    else if (queue.error) status = <ErrorState title="Failed to load queue" error={queue.error} onRetry={queue.reload} />;
    else if (!queueItems?.length) status = <EmptyState title="Queue is empty." />;
  }

  return <div ref={previewRef} className="admin-preview-player" style={frameVars}>
    {status ?? <>
      {screenPicker}
      <div className="admin-preview-player__video">
        <div className="admin-preview-player__video-inner">
          {isQueue ? (
            <Player key={`preview-${contentId}-${currentIndex}`} queue={currentSlice} clear={onClose} playerType="preview" />
          ) : (
            <Player play={mediaConfig} clear={onClose} playerType="preview" />
          )}
        </div>
      </div>

      {isQueue && (
        <>
          <div className="admin-preview-player__queue-info">
            <span>Playing {currentIndex + 1} of {queueItems.length}</span>
          </div>
          <div className="admin-preview-player__queue-bar">
            {queueItems.map((item, i) => (
              <div
                key={item.id || i}
                ref={i === currentIndex ? activeRef : undefined}
                className={`admin-preview-player__queue-item${i === currentIndex ? ' admin-preview-player__queue-item--active' : ''}`}
                onClick={() => setSelection({ path: queuePath, index: i })}
                title={item.title}
              >
                {item.thumbnail ? (
                  <img
                    className="admin-preview-player__queue-thumb"
                    src={DaylightMediaPath(item.thumbnail)}
                    alt=""
                    loading="lazy"
                  />
                ) : (
                  <div className="admin-preview-player__queue-thumb" />
                )}
                <div className="admin-preview-player__queue-title">{item.title}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>}
  </div>;
}
