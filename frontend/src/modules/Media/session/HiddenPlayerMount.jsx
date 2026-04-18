import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Player from '../../Player/Player.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PlayerHostContext } from './LocalSessionProvider.jsx';

const POSITION_PERSIST_INTERVAL_S = 5; // Spec §11.3: persist position every ≥5s while playing

export function HiddenPlayerMount() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('HiddenPlayerMount must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [currentItem, setCurrentItem] = useState(() => adapter.getSnapshot().currentItem);
  const lastPersistedPosition = useRef(0);
  const hasStartedRef = useRef(false);

  // Subscribe to adapter but only re-render when currentItem identity changes.
  // Position/state/config changes don't remount the Player — critical because
  // the Player's audio/video element is torn down when the `play` prop's
  // reference changes.
  useEffect(() => {
    const check = (snap) => {
      const next = snap.currentItem;
      setCurrentItem((prev) => {
        if (prev === next) return prev;
        if (prev && next && prev.contentId === next.contentId && prev.format === next.format
            && prev.title === next.title && prev.duration === next.duration
            && prev.thumbnail === next.thumbnail) {
          return prev; // same content, ignore new reference
        }
        return next;
      });
    };
    check(adapter.getSnapshot());
    return adapter.subscribe(check);
  }, [adapter]);

  // Reset per-item progress gating when current item changes
  useEffect(() => {
    lastPersistedPosition.current = 0;
    hasStartedRef.current = false;
  }, [currentItem?.contentId]);

  const onClear = useCallback(() => adapter.onPlayerEnded(), [adapter]);

  // Player emits onProgress continuously during playback with a payload
  // shape: { currentTime, paused, isSeeking, stalled, ... }. We use the first
  // non-paused tick to transition loading → playing, then throttle position
  // updates to the spec's ≥5s cadence (§11.3).
  const onProgress = useCallback((payload) => {
    const positionSeconds = typeof payload === 'number'
      ? payload
      : payload?.currentTime ?? payload?.seconds;
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return;

    const isPaused = typeof payload === 'object' && payload !== null ? payload.paused : false;
    if (!hasStartedRef.current && !isPaused) {
      hasStartedRef.current = true;
      adapter.onPlayerStateChange('playing');
    }

    const delta = Math.abs(positionSeconds - lastPersistedPosition.current);
    if (delta >= POSITION_PERSIST_INTERVAL_S) {
      adapter.onPlayerProgress(positionSeconds);
      lastPersistedPosition.current = positionSeconds;
    }
  }, [adapter]);

  // Stable play prop across re-renders of the same item.
  const playProp = useMemo(() => {
    if (!currentItem) return null;
    return { ...currentItem };
  }, [currentItem]);

  const hostEl = useContext(PlayerHostContext);

  if (!playProp) return null;

  const tree = (
    <div className="media-player-host">
      <Player play={playProp} clear={onClear} onProgress={onProgress} />
    </div>
  );
  return hostEl ? createPortal(tree, hostEl) : tree;
}

export default HiddenPlayerMount;
