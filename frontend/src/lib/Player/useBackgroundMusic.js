// useBackgroundMusic.js — config-driven ambient audio for ArtMode. Resolves a
// queue/playlist via the existing /api/v1/queue endpoint, drives a hidden <audio>
// element (autoplay → advance on ended → loop, skip on error), and exposes the
// current track for the on-frame music plaque.
import { useEffect, useState } from 'react';
import { DaylightAPI } from '../api.mjs';
import { getChildLogger } from '../logging/singleton.js';
import { toTracks, advanceIndex, shuffleOrder } from './playlist.js';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'artmode-music' }));

const clampVol = (v) => Math.max(0, Math.min(1, typeof v === 'number' ? v : 0.25));

/**
 * @param {{current: HTMLAudioElement|null}} audioRef  element ArtMode renders
 * @param {{queue:string, shuffle?:boolean, volume?:number}|null} music  config
 * @returns {{ track: {title:string, artist:string}|null }}
 */
export function useBackgroundMusic(audioRef, music) {
  const [track, setTrack] = useState(null);
  const queue = music?.queue || null;
  const shuffle = !!music?.shuffle;
  const volume = music?.volume;

  useEffect(() => {
    if (!queue) { setTrack(null); return undefined; }

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

    const step = () => {
      pos = advanceIndex(pos, tracks.length);
      if (pos === 0 && shuffle) order = shuffleOrder(tracks.length);
      playAt(pos);
    };
    const onEnded = () => step();
    const onError = () => { logger().warn?.('artmode.music.error'); step(); };

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
        e.volume = clampVol(volume);
        e.addEventListener('ended', onEnded);
        e.addEventListener('error', onError);
      }
      playAt(0);
    })();

    return () => {
      cancelled = true;
      if (gestureHandler) window.removeEventListener('keydown', gestureHandler);
      const e = el();
      if (e) {
        e.removeEventListener('ended', onEnded);
        e.removeEventListener('error', onError);
        try { e.pause?.(); } catch (_) { /* ignore */ }
        e.removeAttribute?.('src');
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, shuffle, volume]);

  return { track };
}

export default useBackgroundMusic;
