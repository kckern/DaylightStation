import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NativeSelect } from '@mantine/core';
import { DaylightAPI, DaylightMediaPath } from '../../../lib/api.mjs';
import Player from '../../Player/Player.jsx';
import { previewFrameVars } from './previewFrame.js';
import { usePreviewScreens, FALLBACK_SCREEN } from './usePreviewScreens.js';
import getLogger from '../../../lib/logging/Logger.js';
import './AdminPreviewPlayer.scss';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'admin-preview-player' });
  return _logger;
}

const STORAGE_KEY = 'daylight.adminPreview.screenId';

function readStoredScreenId() {
  try { return window.localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
}
function writeStoredScreenId(id) {
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* private mode — selection just won't persist */ }
}

export default function AdminPreviewPlayer({ contentId, action, volume, playbackRate, shuffle, onClose }) {
  const isQueue = action === 'Queue';
  const [queueItems, setQueueItems] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState(null);
  const activeRef = useRef(null);

  // Which real screen this preview is imitating. The Player is sized entirely
  // in rem, so the ONLY thing that makes the preview match the kiosk is laying
  // out in the same number of CSS px the kiosk has.
  const { screens } = usePreviewScreens();
  const [screenId, setScreenId] = useState(readStoredScreenId);

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
    const vars = previewFrameVars(activeScreen.resolution);
    if (vars) return vars;
    // Unreachable today: usePreviewScreens filters every entry through the same
    // predicate previewFrameVars guards with, and FALLBACK_SCREEN is frozen and
    // previewable. Kept because the property making it unreachable lives in
    // ANOTHER module — and because a null style prop is dropped by React, handing
    // the frame to the SCSS defaults with no error and no visual tell, which is
    // the exact bug class this whole change exists to remove. So: never silent.
    logger().warn('frame-vars-fallback', { screenId: activeScreen.id, resolution: activeScreen.resolution });
    return previewFrameVars(FALLBACK_SCREEN.resolution);
  }, [activeScreen]);

  const handleScreenChange = useCallback((event) => {
    const id = event.currentTarget.value;
    logger().debug('screen-changed', { screenId: id });
    setScreenId(id);
    writeStoredScreenId(id);
  }, []);

  // Fetch queue items on mount for Queue mode
  useEffect(() => {
    if (!isQueue || !contentId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await DaylightAPI(`api/v1/queue/${contentId}${shuffle ? '?shuffle=true' : ''}`);
        if (!cancelled && data?.items) {
          setQueueItems(data.items);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [contentId, isQueue, shuffle]);

  // Auto-scroll active item into view
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentIndex]);

  useCallback(() => {
    if (!queueItems) { onClose(); return; }
    const next = currentIndex + 1;
    if (next >= queueItems.length) {
      onClose();
    } else {
      setCurrentIndex(next);
    }
  }, [currentIndex, queueItems, onClose]);

  const handleJump = useCallback((index) => {
    setCurrentIndex(index);
  }, []);

  // Memoised so the option list is not rebuilt on every queue-index change.
  const screenPicker = useMemo(() => (
    <NativeSelect
      size="xs"
      w={220}
      label="Preview at screen"
      value={activeScreen.id}
      onChange={handleScreenChange}
      data={screens.map((s) => ({
        value: s.id,
        label: `${s.name} — ${s.resolution.width}x${s.resolution.height}`,
      }))}
    />
  ), [screens, activeScreen.id, handleScreenChange]);

  // --- Play mode ---
  if (!isQueue) {
    const mediaConfig = { contentId, volume, playbackRate };
    return (
      <div className="admin-preview-player" style={frameVars}>
        {screenPicker}
        <div className="admin-preview-player__video">
          <div className="admin-preview-player__video-inner">
            <Player
              play={mediaConfig}
              clear={onClose}
              playerType="preview"
            />
          </div>
        </div>
      </div>
    );
  }

  // --- Queue mode: loading ---
  if (!queueItems) {
    if (error) return <div style={{ color: 'var(--mantine-color-red-5)', padding: 16 }}>Failed to load queue: {error}</div>;
    return <div style={{ color: 'var(--mantine-color-dimmed)', padding: 16 }}>Loading queue...</div>;
  }

  if (queueItems.length === 0) {
    return <div style={{ color: 'var(--mantine-color-dimmed)', padding: 16 }}>Queue is empty.</div>;
  }

  // --- Queue mode: playing ---
  const playerKey = `preview-${contentId}-${currentIndex}`;
  const currentSlice = queueItems.slice(currentIndex);

  return (
    <div className="admin-preview-player" style={frameVars}>
      {screenPicker}
      <div className="admin-preview-player__video">
        <div className="admin-preview-player__video-inner">
          <Player
            key={playerKey}
            queue={currentSlice}
            clear={onClose}
            playerType="preview"
          />
        </div>
      </div>

      <div className="admin-preview-player__queue-info">
        <span>Playing {currentIndex + 1} of {queueItems.length}</span>
      </div>

      <div className="admin-preview-player__queue-bar">
        {queueItems.map((item, i) => (
          <div
            key={item.id || i}
            ref={i === currentIndex ? activeRef : undefined}
            className={`admin-preview-player__queue-item${i === currentIndex ? ' admin-preview-player__queue-item--active' : ''}`}
            onClick={() => handleJump(i)}
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
    </div>
  );
}
