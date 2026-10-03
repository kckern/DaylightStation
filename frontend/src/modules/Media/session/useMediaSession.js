// frontend/src/modules/Media/session/useMediaSession.js
// Lock-screen and system media controls for playback on THIS device
// (STEER.1a/AC5, RQ-STEER-04), through the browser Media Session API:
// title, show/album, artwork, play/pause/stop, next/previous, seek, and the
// position for the system scrubber. Every system press goes through the same
// session controller as the app's own controls, and is logged.
import { useEffect } from 'react';
import mediaLog from '../logging/mediaLog.js';

const PLAYING = new Set(['playing', 'buffering']);
const SEEK_STEP_S = 10;
const POSITION_PUSH_MS = 5_000;

function absoluteUrl(src) {
  if (typeof src !== 'string' || !src) return null;
  try { return new URL(src, globalThis.location?.href ?? 'http://localhost/').href; } catch { return null; }
}

/** The metadata the system shows for the current item (exported for tests). */
export function mediaSessionMetadata(snapshot) {
  const item = snapshot?.currentItem;
  if (!item) return null;
  const entry = snapshot.queue?.items?.[snapshot.queue?.currentIndex] ?? null;
  const title = typeof item.title === 'string' && item.title !== item.contentId ? item.title : (entry?.title ?? 'Playing');
  const artist = entry?.artist ?? item.artist ?? entry?.containerTitle ?? item.containerTitle ?? '';
  const album = entry?.album ?? item.album ?? '';
  const art = absoluteUrl(item.thumbnail ?? entry?.thumbnail ?? null);
  return { title, artist, album, artwork: art ? [{ src: art, sizes: '512x512' }] : [] };
}

export function bindMediaSession(controller, {
  mediaSession = globalThis.navigator?.mediaSession,
  MediaMetadataCtor = globalThis.MediaMetadata,
  now = () => Date.now(),
} = {}) {
  if (!controller) return () => {};
  if (!mediaSession || typeof mediaSession.setActionHandler !== 'function') {
    mediaLog.mediaSessionUnavailable({ reason: 'no-media-session-api' });
    return () => {};
  }
  const { transport } = controller;
  const press = (action, run) => (details = {}) => {
    mediaLog.mediaSessionAction({ action, ...(details.seekTime != null ? { seekTime: details.seekTime } : {}) });
    try { run(details); } catch (error) {
      mediaLog.mediaSessionFailed({ action, error: error?.message ?? String(error) });
    }
  };
  const handlers = {
    play: press('play', () => transport.play()),
    pause: press('pause', () => transport.pause()),
    stop: press('stop', () => transport.stop()),
    nexttrack: press('nexttrack', () => transport.skipNext()),
    previoustrack: press('previoustrack', () => transport.skipPrev()),
    seekbackward: press('seekbackward', (d) => transport.seekRel(-(Number(d.seekOffset) || SEEK_STEP_S))),
    seekforward: press('seekforward', (d) => transport.seekRel(Number(d.seekOffset) || SEEK_STEP_S)),
    seekto: press('seekto', (d) => { if (Number.isFinite(d.seekTime)) transport.seekAbs(d.seekTime); }),
  };
  const bound = [];
  for (const [action, handler] of Object.entries(handlers)) {
    try { mediaSession.setActionHandler(action, handler); bound.push(action); } catch {
      // Not every browser supports every action; the rest still work.
    }
  }
  mediaLog.mediaSessionBound({ actions: bound });

  let lastKey; // undefined: the first sync always writes
  let lastPositionPush = 0;
  const pushPosition = (snapshot, force = false) => {
    if (typeof mediaSession.setPositionState !== 'function') return;
    const item = snapshot?.currentItem;
    const duration = item?.duration;
    if (!item || item.isLive === true || !Number.isFinite(duration) || duration <= 0) return;
    const t = now();
    if (!force && t - lastPositionPush < POSITION_PUSH_MS) return;
    lastPositionPush = t;
    const position = Math.min(duration, Math.max(0, controller.position?.get?.()?.seconds ?? snapshot.position ?? 0));
    const playbackRate = Number(snapshot.config?.playbackRate) > 0 ? Number(snapshot.config.playbackRate) : 1;
    try { mediaSession.setPositionState({ duration, position, playbackRate }); } catch (error) {
      mediaLog.mediaSessionFailed({ action: 'position', error: error?.message ?? String(error) });
    }
  };
  const sync = (snapshot) => {
    const meta = mediaSessionMetadata(snapshot);
    const key = meta ? `${snapshot.currentItem.contentId}|${meta.title}|${meta.artwork[0]?.src ?? ''}` : null;
    if (key !== lastKey) {
      lastKey = key;
      try {
        mediaSession.metadata = meta && typeof MediaMetadataCtor === 'function' ? new MediaMetadataCtor(meta) : null;
      } catch (error) {
        mediaLog.mediaSessionFailed({ action: 'metadata', error: error?.message ?? String(error) });
      }
      pushPosition(snapshot, true);
    }
    mediaSession.playbackState = !snapshot?.currentItem ? 'none' : (PLAYING.has(snapshot.state) ? 'playing' : 'paused');
  };
  sync(controller.getSnapshot());
  const unsubscribe = controller.subscribe((snapshot) => { sync(snapshot); pushPosition(snapshot, false); });
  const unsubscribePosition = controller.position?.subscribe?.(() => pushPosition(controller.getSnapshot(), false)) ?? (() => {});

  return () => {
    unsubscribe();
    unsubscribePosition();
    for (const action of bound) {
      try { mediaSession.setActionHandler(action, null); } catch { /* ignore */ }
    }
    try { mediaSession.metadata = null; mediaSession.playbackState = 'none'; } catch { /* ignore */ }
  };
}

export function useMediaSession(controller) {
  useEffect(() => bindMediaSession(controller), [controller]);
}

export default useMediaSession;
