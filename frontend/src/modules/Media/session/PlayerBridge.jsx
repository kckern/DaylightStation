// frontend/src/modules/Media/session/PlayerBridge.jsx
// Bridges the local session controller to the platform Player. Hard-won
// behaviors live here; preserve them in any refactor:
//  - The `play` prop identity must be stable per content item — a new object
//    reference remounts the media element.
//  - The Player is portalled into ONE bridge-owned node that is re-parented
//    imperatively, so navigating to/from Now Playing never remounts the Player
//    (audio continues across all views: "playback is ambient, not modal").
//    Guarded by PlayerBridge.test.jsx — do not go back to conditionally
//    portalling; see the note at the render for why that remounts.
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
import { PlayerHostContext, PlayerHostPresentationContext } from './playerHostContext.js';
import { TIMING } from '../constants.js';

const RENDERER_BOUNDARY_FORMATS = new Set(['video', 'hls_video', 'dash_video', 'audio']);

export function PlayerBridge() {
  const ctx = useContext(LocalSessionContext);
  if (!ctx) throw new Error('PlayerBridge must be inside LocalSessionProvider');
  const { controller } = ctx;
  const [currentItem, setCurrentItem] = useState(() => controller.getSnapshot().currentItem);
  // Where this item should START: the persisted/adopted position captured at
  // the moment the item becomes current (C9.1 resume, C7.3 take-over).
  // Normal advancement loads items with position 0, so this is 0 for them.
  const startSecondsRef = useRef(controller.getSnapshot().position ?? 0);
  const playbackGenerationRef = useRef(0);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const lastPersistedPosition = useRef(0);
  const stallTimerRef = useRef(null);
  const stallStartedAtRef = useRef(null);
  const playerRef = useRef(null);
  const rendererOperationObserverRef = useRef(null);
  const bindNativeOperationRef = useRef(null);
  const rendererOperationSequenceRef = useRef(0);
  const pendingInitialRendererOperationRef = useRef(null);

  // Hand the controller its imperative player surface.
  useEffect(() => {
    controller.setPlayerHandle({
      play: () => playerRef.current?.play?.(),
      pause: () => playerRef.current?.pause?.(),
      seek: (t) => playerRef.current?.seek?.(t),
      setPlaybackRate: (rate) => playerRef.current?.setPlaybackRate?.(rate),
      setShader: (shader) => playerRef.current?.setShader?.(shader),
      getMediaElement: () => playerRef.current?.getMediaElement?.() ?? null,
      getMountedContentId: () => playerRef.current?.getMountedContentId?.() ?? null,
      getMountedMediaGeneration: () => playerRef.current?.getMountedMediaGeneration?.() ?? null,
      beginRendererBoundary: (request) => {
        const observerId = rendererOperationObserverRef.current?.observerId ?? null;
        if (!observerId) return { ok: false, code: 'OBSERVER_NOT_READY' };
        return playerRef.current?.beginRendererBoundary?.({
          ...request,
          requiredObserverIds: [observerId],
        }) ?? { ok: false, code: 'PLAYER_NOT_READY' };
      },
    });
    return () => controller.setPlayerHandle({});
  }, [controller]);

  const hasCurrentItem = Boolean(currentItem);
  useEffect(() => {
    if (!hasCurrentItem || typeof playerRef.current?.subscribeMountedMediaOperations !== 'function') return undefined;
    const subscription = playerRef.current.subscribeMountedMediaOperations((binding) => {
      const ready = bindNativeOperationRef.current?.(binding) === true;
      return ready ? { ready: true, ...binding } : { ready: false };
    });
    rendererOperationObserverRef.current = subscription;
    const pendingInitial = pendingInitialRendererOperationRef.current;
    if (pendingInitial && subscription?.observerId) {
      playerRef.current?.beginRendererBoundary?.({
        ...pendingInitial,
        requiredObserverIds: [subscription.observerId],
      });
      pendingInitialRendererOperationRef.current = null;
    }
    return () => {
      if (rendererOperationObserverRef.current === subscription) rendererOperationObserverRef.current = null;
      subscription?.unsubscribe?.();
    };
  // This observer identifies the bridge, not one content item. Re-subscribing
  // on an A -> B adoption removes the exact observer ID that the synchronous
  // renderer-boundary request just marked as required, so B can never admit
  // its mounted decoder operation and its native resume seek remains at zero.
  }, [hasCurrentItem]);

  // Track volume so we can sync it to the media element as the user adjusts it.
  const [volume, setVolume] = useState(() => controller.getSnapshot().config?.volume ?? 100);
  const [playbackRate, setPlaybackRate] = useState(() => controller.getSnapshot().config?.playbackRate ?? 1);
  const [sessionShader, setSessionShader] = useState(() => controller.getSnapshot().config?.shader ?? null);
  useEffect(() => {
    return controller.subscribe((snap) => {
      const next = snap.config?.volume ?? 100;
      setVolume((prev) => (prev === next ? prev : next));
      const nextRate = snap.config?.playbackRate ?? 1;
      setPlaybackRate((prev) => (prev === nextRate ? prev : nextRate));
      const nextShader = snap.config?.shader ?? null;
      setSessionShader((prev) => (prev === nextShader ? prev : nextShader));
    });
  }, [controller]);
  useEffect(() => { playerRef.current?.setPlaybackRate?.(playbackRate); }, [playbackRate, currentItem?.contentId]);
  useEffect(() => { playerRef.current?.setShader?.(sessionShader); }, [sessionShader, currentItem?.contentId]);
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

  // Re-render only for an explicit playback generation or a new content ID —
  // position, state, config, and metadata observations must not remount the
  // Player. Explicit LOAD/SET/ADOPT actions still restart same-ID content.
  useEffect(() => {
    const check = (snap, action = null) => {
      const next = snap.currentItem;
      const startsPlayback = action != null
        && ['LOAD_ITEM', 'SET_CURRENT_ITEM', 'ADOPT_SNAPSHOT'].includes(action.type);
      if (startsPlayback) {
        const requestedStart = Number.isFinite(snap.position) ? snap.position : 0;
        startSecondsRef.current = requestedStart;
        playbackGenerationRef.current += 1;
        if (action.type === 'ADOPT_SNAPSHOT' && next?.contentId && !playerRef.current
          && next.isLive !== true && RENDERER_BOUNDARY_FORMATS.has(next.format)) {
          pendingInitialRendererOperationRef.current = {
            operationId: `local-owner-${++rendererOperationSequenceRef.current}`,
            expectedContentId: next.contentId,
            targetSeconds: requestedStart,
            autoplay: action.autoplay !== false,
            source: 'local-adopt_snapshot',
            format: next.format,
            isLive: next.isLive === true,
          };
        }
        const mountedMatchesRequested = next?.contentId
          && playerRef.current?.getMountedContentId?.() === next.contentId;
        if (next?.contentId && (action.type === 'ADOPT_SNAPSHOT' || mountedMatchesRequested)) {
          // Shared Player intentionally derives identity from content, so a
          // same-content generation with the same scalar props (especially
          // zero or a repeated offset) will not restart on object identity.
          // The controller may replace its queue snapshot with B before its
          // LOAD_ITEM(B), while Player still exposes A's native element. Only
          // apply the generation when Player confirms that the actual accessor
          // node belongs to B; requested/store identity is not media evidence.
          const observerId = rendererOperationObserverRef.current?.observerId ?? null;
          if (observerId) {
            playerRef.current?.beginRendererBoundary?.({
              operationId: `local-owner-${++rendererOperationSequenceRef.current}`,
              expectedContentId: next.contentId,
              targetSeconds: requestedStart,
              autoplay: action.type === 'ADOPT_SNAPSHOT' ? action.autoplay !== false : true,
              requiredObserverIds: [observerId],
              source: `local-${String(action.type).toLowerCase()}`,
              format: next.format,
              isLive: next.isLive === true,
            });
          }
        }
        setPlaybackGeneration(playbackGenerationRef.current);
      }
      setCurrentItem((prev) => {
        if (startsPlayback) {
          // ADOPT can reuse the same PlayableItem object. Clone it so the
          // play prop records the new generation and requested start offset.
          return next === prev && next ? { ...next } : next;
        }
        if (prev === next) return prev;
        if (prev && next && prev.contentId === next.contentId) {
          // Resolved duration/format/title are session metadata, not playback
          // identity. Keep the original object handed to Player so enrichment
          // cannot restart the media or reapply its start position.
          return prev;
        }
        // New item: its start position is whatever the snapshot carries at
        // adoption time (persisted resume, claimed take-over, or 0).
        startSecondsRef.current = snap.position ?? 0;
        return next;
      });
    };
    check(controller.getSnapshot());
    if (controller.store?.onTransition) {
      return controller.store.onTransition((_prev, next, action) => check(next, action));
    }
    return controller.subscribe(check);
  }, [controller]);

  // Reset per-item progress gating when the current item changes.
  useEffect(() => {
    lastPersistedPosition.current = 0;
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
      stallStartedAtRef.current = null;
    }
  }, [currentItem?.contentId, playbackGeneration]);

  const contentId = currentItem?.contentId ?? null;
  const onClear = useCallback(() => {
    if (playbackGenerationRef.current !== playbackGeneration) return;
    controller.onPlayerEnded(contentId);
  }, [controller, contentId, playbackGeneration]);

  // Player emits onProgress with { currentTime, paused, isSeeking, stalled }.
  const onProgress = useCallback((payload) => {
    if (playbackGenerationRef.current !== playbackGeneration) return;
    if (!contentId || controller.getSnapshot().currentItem?.contentId !== contentId) return;
    if (typeof payload === 'object' && payload !== null) {
      controller.onPlayerObservation?.(contentId, payload);
    }
    const positionSeconds = typeof payload === 'number'
      ? payload
      : payload?.currentTime ?? payload?.seconds;
    if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds)) return;

    const isPaused = typeof payload === 'object' && payload !== null ? payload.paused : false;

    // Stall detection — suppressed for live content (no progress contract).
    const isLive = !!controller.getSnapshot().currentItem?.isLive;
    const isStalled = typeof payload === 'object' && payload !== null ? !!payload.stalled : false;
    if (isStalled && !isPaused && !isLive) {
      if (!stallTimerRef.current) {
        stallStartedAtRef.current = Date.now();
        stallTimerRef.current = setTimeout(() => {
          const startedAt = stallStartedAtRef.current;
          stallTimerRef.current = null;
          stallStartedAtRef.current = null;
          if (startedAt == null) return;
          if (playbackGenerationRef.current !== playbackGeneration) return;
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
    if (!isSeeking) controller.onPlayerPositionTick(positionSeconds, contentId);

    // Durable tier — ≥5s cadence.
    const delta = Math.abs(positionSeconds - lastPersistedPosition.current);
    if (delta >= TIMING.POSITION_PERSIST_INTERVAL_S) {
      controller.onPlayerProgress(positionSeconds, contentId);
      lastPersistedPosition.current = positionSeconds;
    }
  }, [controller, contentId, playbackGeneration]);

  // Player's imperative accessor resolves the native media node even for DASH,
  // where the <video> lives inside <dash-video>'s shadow root. Bind discrete
  // native events so pause/resume and duration are observed even when no
  // timeupdate happens at that boundary. Keep polling to follow a resilience
  // replacement of the inner element without creating a second player.
  useEffect(() => {
    if (!contentId) return undefined;
    let bound = null;
    let boundContentId = null;
    let boundMediaGeneration = null;
    let detach = () => {};

    const bind = (operationBinding = null) => {
      const next = operationBinding?.node ?? playerRef.current?.getMediaElement?.() ?? null;
      const resolvedContentId = playerRef.current?.getMountedContentId?.() ?? null;
      const resolvedMediaGeneration = operationBinding?.resolvedGeneration
        ?? playerRef.current?.getMountedMediaGeneration?.()
        ?? null;
      if (operationBinding) {
        const accepted = playerRef.current?.getMountedMediaRegistration?.() ?? null;
        if (playerRef.current?.getMediaElement?.() !== next
          || accepted?.node !== next
          || accepted?.resolvedGeneration !== operationBinding.resolvedGeneration
          || accepted?.rendererToken !== operationBinding.rendererToken) return false;
      }
      if (next === bound
        && resolvedContentId === boundContentId
        && resolvedMediaGeneration === boundMediaGeneration) {
        if (operationBinding) {
          controller.bindNativeObservation?.(next, resolvedContentId, resolvedMediaGeneration, operationBinding);
        }
        return true;
      }
      const retired = bound;
      const retiredGeneration = boundMediaGeneration;
      detach();
      bound = next;
      boundContentId = resolvedContentId;
      boundMediaGeneration = resolvedMediaGeneration;
      if (!bound) {
        if (retired) controller.releaseNativeObservation?.(retired, retiredGeneration);
        detach = () => {};
        return false;
      }
      const observedElement = bound;
      const observedPlaybackGeneration = playbackGenerationRef.current;
      controller.bindNativeObservation?.(observedElement, resolvedContentId, resolvedMediaGeneration, operationBinding);
      const isCurrentMedia = () => playbackGenerationRef.current === observedPlaybackGeneration
        && controller.getSnapshot().currentItem?.contentId === contentId
        && playerRef.current?.getMediaElement?.() === observedElement
        && playerRef.current?.getMountedContentId?.() === contentId;

      const observeNative = (type) => {
        if (!isCurrentMedia()) return false;
        controller.onNativeObservationEvent?.(observedElement, type);
        return true;
      };

      const observeDuration = () => {
        if (!isCurrentMedia()) return;
        observeNative('durationchange');
        controller.onPlayerObservation?.(contentId, { duration: bound.duration });
      };
      const observePaused = () => {
        if (observeNative('pause') && !bound.ended) controller.onPlayerStateChange('paused', contentId);
      };
      const observePlaying = () => {
        if (observeNative('playing')) controller.onPlayerStateChange('playing', contentId);
      };
      const observeWaiting = () => {
        if (observeNative('waiting') && !bound.paused) {
          controller.onPlayerStateChange('buffering', contentId);
        }
      };
      const observeSeeked = () => {
        if (!isCurrentMedia()) return;
        observeNative('seeked');
        // A paused decoder need not emit another progress tick after seeked.
        // Reconcile its completed native position through the same hot/durable
        // path as Player progress, without publishing the requested target.
        onProgress({
          currentTime: bound.currentTime,
          duration: bound.duration,
          // seeked proves position completion, not resumed frames. A true
          // native pause is evidence; an unpaused decoder may still buffer.
          ...(bound.paused ? { paused: true } : {}),
          isSeeking: false,
        });
      };
      const observeSeeking = () => {
        if (!isCurrentMedia()) return;
        observeNative('seeking');
        // The native position is already observable while the decoder seeks.
        // Update only the hot display; completion, durable position, and
        // playback state still require their own evidence.
        controller.onPlayerPositionTick(bound.currentTime, contentId);
      };
      const observeTimeUpdate = () => { observeNative('timeupdate'); };
      const observeEnded = () => { observeNative('ended'); };
      const observeError = () => { observeNative('error'); };
      bound.addEventListener('loadedmetadata', observeDuration);
      bound.addEventListener('durationchange', observeDuration);
      bound.addEventListener('pause', observePaused);
      bound.addEventListener('playing', observePlaying);
      bound.addEventListener('waiting', observeWaiting);
      bound.addEventListener('seeked', observeSeeked);
      bound.addEventListener('seeking', observeSeeking);
      bound.addEventListener('timeupdate', observeTimeUpdate);
      bound.addEventListener('ended', observeEnded);
      bound.addEventListener('error', observeError);
      observeDuration();
      detach = () => {
        bound?.removeEventListener('loadedmetadata', observeDuration);
        bound?.removeEventListener('durationchange', observeDuration);
        bound?.removeEventListener('pause', observePaused);
        bound?.removeEventListener('playing', observePlaying);
        bound?.removeEventListener('waiting', observeWaiting);
        bound?.removeEventListener('seeked', observeSeeked);
        bound?.removeEventListener('seeking', observeSeeking);
        bound?.removeEventListener('timeupdate', observeTimeUpdate);
        bound?.removeEventListener('ended', observeEnded);
        bound?.removeEventListener('error', observeError);
      };
      return true;
    };

    bindNativeOperationRef.current = bind;
    bind();
    const poll = setInterval(bind, TIMING.VOLUME_APPLY_RETRY_MS);
    return () => {
      clearInterval(poll);
      if (bindNativeOperationRef.current === bind) bindNativeOperationRef.current = null;
      const retired = bound;
      const retiredGeneration = boundMediaGeneration;
      detach();
      // The live imperative handle is intentionally read at cleanup so a
      // replacement can be distinguished from the retired binding.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const currentHandle = playerRef.current;
      const currentNode = currentHandle?.getMediaElement?.() ?? null;
      const currentGeneration = currentHandle?.getMountedMediaGeneration?.() ?? null;
      if (retired && (currentNode !== retired || currentGeneration !== retiredGeneration)) {
        controller.releaseNativeObservation?.(retired, retiredGeneration);
      }
    };
  }, [controller, contentId, playbackGeneration, onProgress]);

  // Stable play prop across re-renders of the same item. The platform
  // Player honors `seconds` as the start offset.
  const playProp = useMemo(() => {
    if (!currentItem) return null;
    const seconds = startSecondsRef.current;
    return seconds > 0 ? { ...currentItem, seconds } : { ...currentItem };
  }, [currentItem]);

  const hostEl = useContext(PlayerHostContext);
  const { forceShader } = useContext(PlayerHostPresentationContext);

  // The Player ALWAYS portals into this one node, which React never reconciles
  // away, and the node is re-parented imperatively as views claim/release the
  // host. Rendering the tree directly when unhosted and portalling when hosted
  // looks equivalent but is not: React matches a portal against a plain element
  // (and a portal against a portal with a different containerInfo) as a type
  // change, so every host transition tore the media element out of the
  // document. On 2026-08-16 a phone dispatched an audio track with no host
  // claimed, the Player mounted in the park, the arriving claim remounted it
  // mid-play() — "The play() request was interrupted because the media was
  // removed from the document" — and the track needed the 15s stall watchdog
  // to recover, 19s after the tap. A same-document appendChild does not
  // interrupt playback; a remount always does.
  const hostNodeRef = useRef(null);
  if (hostNodeRef.current === null) {
    const el = document.createElement('div');
    el.className = 'media-player-host';
    hostNodeRef.current = el;
  }
  // Attached during render (not in an effect) so the media element is never
  // mounted into a detached tree: the Player's own mount effects run before any
  // effect here could attach it.
  if (!hostNodeRef.current.isConnected) document.body.appendChild(hostNodeRef.current);

  useEffect(() => {
    const node = hostNodeRef.current;
    const parent = hostEl ?? document.body;
    const hidden = !hostEl;
    node.classList.toggle('media-player-host--hidden', hidden);
    node.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    // Parked off-screen rather than display:none — a hidden media element is
    // throttled or refused playback by mobile browsers.
    Object.assign(node.style, hidden
      ? { position: 'fixed', left: '-10000px', top: '0', width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none' }
      : { position: '', left: '', top: '', width: '', height: '', overflow: '', pointerEvents: '' });
    if (node.parentNode !== parent) parent.appendChild(node);
  }, [hostEl]);

  useEffect(() => () => hostNodeRef.current?.remove(), []);

  if (!playProp) return null;

  return createPortal(
    /* ignoreKeys: the Player's global hotkeys (Space/Tab/Backspace/arrows)
       are for kiosk surfaces with no text inputs or tab order. This app
       has a search box and full transport UI — it owns its keys. */
    <Player
      ref={playerRef}
      play={playProp}
      clear={onClear}
      onProgress={onProgress}
      forceShader={forceShader ?? undefined}
      ignoreKeys
      initialRendererOperation={pendingInitialRendererOperationRef.current}
    />,
    hostNodeRef.current
  );
}

export default PlayerBridge;
