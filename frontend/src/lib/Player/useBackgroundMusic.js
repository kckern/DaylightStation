// useBackgroundMusic.js — config-driven ambient audio for ArtMode. Resolves a
// queue/playlist via the existing /api/v1/queue endpoint, drives a hidden <audio>
// element (autoplay → advance on ended → loop, skip on error), and exposes the
// current track for the on-frame music plaque plus next()/prev() skip controls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { getChildLogger } from '../logging/singleton.js';
import { useEffectiveVolume } from '../volume/ScreenVolumeContext.js';
import { toTracks, advanceIndex, shuffleOrder } from './playlist.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'artmode-music' }));

const clampVol = (v) => Math.max(0, Math.min(1, typeof v === 'number' ? v : 0.25));
const NOOP = () => {};

/**
 * @param {{current: HTMLAudioElement|null}} audioRef  element ArtMode renders
 * @param {{queue:string, shuffle?:boolean, volume?:number}|null} music  config
 * @returns {{ track: {title:string, artist:string}|null, next: ()=>void, prev: ()=>void }}
 */
export function useBackgroundMusic(audioRef, music) {
  const [track, setTrack] = useState(null);
  const queue = music?.queue || null;
  const shuffle = !!music?.shuffle;
  const volume = music?.volume;

  // Effective output = preset local volume × the screen's software master (so the
  // office/remote volume keys drive ArtMode's background music). Outside the
  // screen-framework the master defaults to 1, so this stays a no-op there.
  const effectiveVolume = useEffectiveVolume(clampVol(volume));
  const effVolRef = useRef(effectiveVolume);
  useEffect(() => {
    effVolRef.current = effectiveVolume;
    const e = audioRef.current;
    if (e) e.volume = effectiveVolume;
  }, [effectiveVolume, audioRef]);

  // Transport controls are stable wrappers over the live effect-scoped
  // implementation, so callers (ArtMode key/action handlers) keep a stable
  // reference. next/prev skip songs; toggle play/pauses; seek scrubs within the
  // current song (positive = forward).
  const controlsRef = useRef({ next: NOOP, prev: NOOP, toggle: NOOP, seek: NOOP });
  const next = useCallback(() => controlsRef.current.next(), []);
  const prev = useCallback(() => controlsRef.current.prev(), []);
  const toggle = useCallback(() => controlsRef.current.toggle(), []);
  const seek = useCallback((deltaSec) => controlsRef.current.seek(deltaSec), []);

  useEffect(() => {
    if (!queue) { setTrack(null); controlsRef.current = { next: NOOP, prev: NOOP, toggle: NOOP, seek: NOOP }; return undefined; }

    let cancelled = false;
    let tracks = [];
    let order = [];
    let pos = 0;
    let gestureHandler = null;

    const el = () => audioRef.current;

    const bindGestureRetry = () => {
      if (gestureHandler) return;
      gestureHandler = () => {
        window.removeEventListener('keydown', gestureHandler);
        gestureHandler = null;
        const e = el();
        try { e?.play?.(); } catch (_) { /* ignore */ }
      };
      window.addEventListener('keydown', gestureHandler, { once: true });
    };

    const safePlay = (e) => {
      try {
        const r = e.play?.();
        if (r && typeof r.catch === 'function') {
          r.catch(() => { logger().info?.('artmode.music.autoplay-blocked'); bindGestureRetry(); });
        }
      } catch (_) {
        // jsdom / unsupported play() — ignore.
      }
    };

    const playAt = (p) => {
      const e = el();
      if (!e || !tracks.length) return;
      const t = tracks[order[p]];
      e.src = t.mediaUrl;
      setTrack({ title: t.title, artist: t.artist });
      logger().debug?.('artmode.music.track', { title: t.title, artist: t.artist });
      safePlay(e);
    };

    // Move `delta` tracks (forward on +1 / track-ended; backward on -1 for prev).
    // Re-shuffle on a forward wrap so the next loop differs (matches prior behavior).
    const stepBy = (delta) => {
      if (!tracks.length) return;
      if (delta >= 0) {
        pos = advanceIndex(pos, tracks.length);
        if (pos === 0 && shuffle) order = shuffleOrder(tracks.length);
      } else {
        pos = (pos - 1 + tracks.length) % tracks.length;
      }
      playAt(pos);
    };
    const step = () => stepBy(1);
    const onEnded = () => step();
    const onError = () => { logger().warn?.('artmode.music.error'); step(); };

    // Play/pause toggle. Pausing the music effectively pauses ArtMode in track
    // mode (no song change → no art advance).
    const toggle = () => {
      const e = el();
      if (!e) return;
      if (e.paused) { safePlay(e); logger().debug?.('artmode.music.resume'); }
      else { try { e.pause?.(); } catch (_) { /* ignore */ } logger().debug?.('artmode.music.pause'); }
    };

    // Scrub within the current song (clamped to its bounds), leaving the track
    // and the on-frame plaque unchanged — distinct from next/prev song skips.
    const seek = (deltaSec) => {
      const e = el();
      if (!e) return;
      const dur = Number.isFinite(e.duration) && e.duration > 0 ? e.duration : Infinity;
      const at = Math.max(0, Math.min(dur === Infinity ? Number.MAX_SAFE_INTEGER : dur,
        (Number.isFinite(e.currentTime) ? e.currentTime : 0) + deltaSec));
      try { e.currentTime = at; } catch (_) { /* ignore */ }
      logger().debug?.('artmode.music.seek', { deltaSec, at });
    };

    controlsRef.current = { next: () => stepBy(1), prev: () => stepBy(-1), toggle, seek };

    (async () => {
      let resp;
      try {
        resp = await DaylightAPI(`api/v1/queue/${encodeURIComponent(queue)}${shuffle ? '?shuffle=1' : ''}`);
      } catch (err) {
        if (!cancelled) { logger().warn?.('artmode.music.error', { error: err?.message }); setTrack(null); }
        return;
      }
      if (cancelled) return;
      tracks = toTracks(resp);
      if (!tracks.length) { logger().info?.('artmode.music.empty'); setTrack(null); return; }
      order = shuffle ? shuffleOrder(tracks.length) : tracks.map((_, i) => i);
      pos = 0;
      logger().info?.('artmode.music.loaded', { count: tracks.length });
      const e = el();
      if (e) {
        e.volume = effVolRef.current;
        e.addEventListener('ended', onEnded);
        e.addEventListener('error', onError);
      }
      playAt(0);
    })();

    return () => {
      cancelled = true;
      controlsRef.current = { next: NOOP, prev: NOOP, toggle: NOOP, seek: NOOP };
      if (gestureHandler) window.removeEventListener('keydown', gestureHandler);
      const e = el();
      if (e) {
        e.removeEventListener('ended', onEnded);
        e.removeEventListener('error', onError);
        try { e.pause?.(); } catch (_) { /* ignore */ }
        e.removeAttribute?.('src');
      }
    };
  // Volume is intentionally omitted: it's applied live via effVolRef + the
  // effectiveVolume effect above, so changing it must not reload the playlist.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, shuffle]);

  return { track, next, prev, toggle, seek };
}

export default useBackgroundMusic;
