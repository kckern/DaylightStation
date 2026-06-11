// frontend/src/modules/Media/session/PlayerBridge.jsx
// Bridges the local session controller to the platform Player. Hard-won
// behaviors live here; preserve them in any refactor:
//  - The `play` prop identity must be stable per content item — a new object
//    reference remounts the media element.
//  - The tree shape is identical whether hidden or portal-hosted, so
//    navigating to/from Now Playing never remounts the Player (audio
//    continues across all views: "playback is ambient, not modal").
//  - Volume is applied imperatively via getMediaElement() with a bounded
//    retry, because the element may not exist when the effect first runs and
//    routing volume through the play prop would remount the Player.
//  - Position ticks feed the hot position channel only; the durable
//    snapshot position is written on the ≥5s cadence (§11.3).
//  - Stall detection (C9.3) is suppressed for live content, which has no
//    forward progress contract.
import React, { useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Player from '../../Player/Player.jsx';
import { LocalSessionContext } from './LocalSessionContext.js';
import { PlayerHostContext } from './playerHostContext.js';
import { TIMING } from '../constants.js';

export function PlayerBridge() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('PlayerBridge must be inside LocalSessionProvider');
  const { controller } = ctx;
  const [currentItem, setCurrentItem] = useState(() => controller.getSnapshot().currentItem);
  // Where this item should START: the persisted/adopted position captured at
  // the moment the item becomes current (C9.1 resume, C7.3 take-over).
  // Normal advancement loads items with position 0, so this is 0 for them.
  const startSecondsRef = useRef(controller.getSnapshot().position ?? 0);
  const lastPersistedPosition = useRef(0);
  const hasStartedRef = useRef(false);
  const stallTimerRef = useRef(null);
  const stallStartedAtRef = useRef(null);
  const playerRef = useRef(null);

  // Hand the controller its imperative player surface.
  useEffect(() => {
    controller.setPlayerHandle({
      play: () => playerRef.current?.play?.(),
      pause: () => playerRef.current?.pause?.(),
      seek: (t) => playerRef.current?.seek?.(t),
    });
    return () => controller.setPlayerHandle({});
  }, [controller]);

  // Track volume so we can sync it to the media element as the user adjusts it.
  const [volume, setVolume] = useState(() => controller.getSnapshot().config?.volume ?? 100);
  useEffect(() => {
    return controller.subscribe((snap) => {
      const next = snap.config?.volume ?? 100;
      setVolume((prev) => (prev === next ? prev : next));
    });
  }, [controller]);
  useEffect(() => {
    let cancelled = false;
    const target = Math.max(0, Math.min(1, volume / 100));
    const apply = () => {
      const el = playerRef.current?.getMediaElement?.();
      if (el) {
        try { el.volume = target; } catch { /* ignore */ }
        return true;
      }
      return false;
    };
    if (apply()) return () => {};
    const id = setInterval(() => { if (cancelled || apply()) clearInterval(id); }, TIMING.VOLUME_APPLY_RETRY_MS);
    const timeout = setTimeout(() => clearInterval(id), TIMING.VOLUME_APPLY_GIVE_UP_MS);
    return () => { cancelled = true; clearInterval(id); clearTimeout(timeout); };
  }, [volume, currentItem?.contentId]);

  useEffect(() => () => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  // Re-render only when the current item's identity changes — position,
  // state, and config changes must not remount the Player.
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
        // New item: its start position is whatever the snapshot carries at
        // adoption time (persisted resume, claimed take-over, or 0).
        startSecondsRef.current = snap.position ?? 0;
        return next;
      });
    };
    check(controller.getSnapshot());
    return controller.subscribe(check);
  }, [controller]);

  // Reset per-item progress gating when the current item changes.
  useEffect(() => {
    lastPersistedPosition.current = 0;
    hasStartedRef.current = false;
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }
  }, [currentItem?.contentId]);

  const onClear = useCallback(() => controller.onPlayerEnded(), [controller]);

  // Player emits onProgress with { currentTime, paused, isSeeking, stalled }.
  const onProgress = useCallback((payload) => {
    const positionSeconds = typeof payload === 'number'
      ? payload
      : payload?.currentTime ?? payload?.seconds;
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return;

    const isPaused = typeof payload === 'object' && payload !== null ? payload.paused : false;
    if (!hasStartedRef.current && !isPaused) {
      hasStartedRef.current = true;
      controller.onPlayerStateChange('playing');
    }

    // Stall detection — suppressed for live content (no progress contract).
    const isLive = !!currentItem?.isLive;
    const isStalled = typeof payload === 'object' && payload !== null ? !!payload.stalled : false;
    if (isStalled && !isPaused && !isLive) {
      if (!stallTimerRef.current) {
        stallStartedAtRef.current = Date.now();
        stallTimerRef.current = setTimeout(() => {
          const startedAt = stallStartedAtRef.current;
          stallTimerRef.current = null;
          stallStartedAtRef.current = null;
          if (startedAt == null) return;
          controller.onPlayerStalled({ stalledMs: Date.now() - startedAt });
        }, TIMING.STALL_THRESHOLD_MS);
      }
    } else if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }

    // Hot tier — suppressed while seeking so pre-seek ticks don't snap the
    // seek bar back to the old position.
    const isSeeking = typeof payload === 'object' && payload !== null ? !!payload.isSeeking : false;
    if (!isSeeking) controller.onPlayerPositionTick(positionSeconds);

    // Durable tier — ≥5s cadence.
    const delta = Math.abs(positionSeconds - lastPersistedPosition.current);
    if (delta >= TIMING.POSITION_PERSIST_INTERVAL_S) {
      controller.onPlayerProgress(positionSeconds);
      lastPersistedPosition.current = positionSeconds;
    }
  }, [controller, currentItem?.isLive]);

  // Stable play prop across re-renders of the same item. The platform
  // Player honors `seconds` as the start offset.
  const playProp = useMemo(() => {
    if (!currentItem) return null;
    const seconds = startSecondsRef.current;
    return seconds > 0 ? { ...currentItem, seconds } : { ...currentItem };
  }, [currentItem]);

  const hostEl = useContext(PlayerHostContext);

  if (!playProp) return null;

  // Identical tree shape hidden vs hosted — see header comment.
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
      {/* ignoreKeys: the Player's global hotkeys (Space/Tab/Backspace/arrows)
          are for kiosk surfaces with no text inputs or tab order. This app
          has a search box and full transport UI — it owns its keys. */}
      <Player ref={playerRef} play={playProp} clear={onClear} onProgress={onProgress} ignoreKeys />
    </div>
  );
  return hostEl ? createPortal(tree, hostEl) : tree;
}

export default PlayerBridge;
