import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Player from '../../Player/Player.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PlayerHostContext } from './LocalSessionProvider.jsx';

const POSITION_PERSIST_INTERVAL_S = 5; // Spec §11.3: persist position every ≥5s while playing
const STALL_THRESHOLD_MS = 10_000; // Spec C9.3: persistent stall = no progress 10s while unpaused

export function HiddenPlayerMount() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('HiddenPlayerMount must be inside LocalSessionProvider');
  const { adapter } = ctx;
  const [currentItem, setCurrentItem] = useState(() => adapter.getSnapshot().currentItem);
  const lastPersistedPosition = useRef(0);
  const hasStartedRef = useRef(false);
  const stallTimerRef = useRef(null);
  const stallStartedAtRef = useRef(null);

  useEffect(() => () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

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
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }
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

    const isStalled = typeof payload === 'object' && payload !== null
      ? !!payload.stalled : false;
    if (isStalled && !isPaused) {
      if (!stallTimerRef.current) {
        stallStartedAtRef.current = Date.now();
        stallTimerRef.current = setTimeout(() => {
          const stalledMs = Date.now() - (stallStartedAtRef.current ?? Date.now());
          stallTimerRef.current = null;
          stallStartedAtRef.current = null;
          adapter.onPlayerStalled({ stalledMs });
        }, STALL_THRESHOLD_MS);
      }
    } else if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
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

  // The Player lives in the same <div.media-player-host> in both modes —
  // only the styling changes and (when a view claims the host) whether
  // React portals the subtree. Keeping the tree shape identical across the
  // transition preserves the Player instance, so audio/video doesn't
  // remount when the user navigates between Home/Browse and NowPlaying.
  const hidden = !hostEl;
  const hiddenStyle = hidden
    ? {
        position: 'fixed',
        left: '-10000px',
        top: 0,
        width: '1px',
        height: '1px',
        overflow: 'hidden',
        pointerEvents: 'none',
      }
    : null;
  const tree = (
    <div
      className={hidden ? 'media-player-host media-player-host--hidden' : 'media-player-host'}
      style={hiddenStyle}
      aria-hidden={hidden ? 'true' : 'false'}
    >
      <Player play={playProp} clear={onClear} onProgress={onProgress} />
    </div>
  );
  return hostEl ? createPortal(tree, hostEl) : tree;
}

export default HiddenPlayerMount;
