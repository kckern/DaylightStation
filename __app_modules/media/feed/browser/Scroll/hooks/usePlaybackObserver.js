import { useVisibleRefresh, whileDocumentVisible } from '@/lib/hooks/useVisibleRefresh.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { feedLog } from "../feedLog.js";

// All Feed controls display the persistent player's clock, even as routes change.
export function usePlaybackObserver(playerRef, active) {
  const [state, setState] = useState({ playing: false, currentTime: 0, duration: 0 });
  const progressElRef = useRef(null);
  const detailProgressElRef = useRef(null);
  const sheetProgressElRef = useRef(null);
  const lastPlaying = useRef(null);
  const missingPlayerLogged = useRef(false);

  const sample = useCallback(() => {
    const player = playerRef.current;
    if (!player) {
      if (!missingPlayerLogged.current) feedLog.player('poll: playerRef.current is null');
      missingPlayerLogged.current = true;
      return;
    }
    missingPlayerLogged.current = false;
    const media = player.getMediaElement?.();
    const playing = Boolean(media && !media.paused);
    const currentTime = player.getCurrentTime?.() || 0;
    const duration = player.getDuration?.() || 0;
    if (lastPlaying.current !== playing) {
      feedLog.player('state change', { playing, currentTime: currentTime.toFixed(1), duration: duration.toFixed(1) });
      lastPlaying.current = playing;
    }
    setState(previous => previous.playing === playing && previous.currentTime === currentTime && previous.duration === duration
      ? previous : { playing, currentTime, duration });
  }, [playerRef]);
  useVisibleRefresh({ active, intervalMs: 500, reload: sample });

  useEffect(() => {
    lastPlaying.current = null;
    missingPlayerLogged.current = false;
    if (!active) {
      feedLog.player('observer inactive — resetting state');
      setState({ playing: false, currentTime: 0, duration: 0 });
      return;
    }
    feedLog.player('observer active — starting 500ms poll');
    return whileDocumentVisible(() => {
      let frame;
      function paint() {
        const player = playerRef.current;
        const mini = progressElRef.current;
        const detail = detailProgressElRef.current;
        const sheet = sheetProgressElRef.current;
        if (mini || detail || sheet) {
          const duration = player?.getDuration?.() || 0;
          const position = player?.getCurrentTime?.() || 0;
          const width = `${duration > 0 ? position / duration * 100 : 0}%`;
          if (mini) mini.style.width = width;
          if (detail) detail.style.width = width;
          if (sheet) sheet.style.width = width;
        }
        frame = requestAnimationFrame(paint);
      }
      frame = requestAnimationFrame(paint);
      return () => cancelAnimationFrame(frame);
    });
  }, [active, playerRef]);

  const toggle = useCallback(() => {
    feedLog.player('toggle');
    playerRef.current?.toggle?.();
  }, [playerRef]);

  const seek = useCallback((t) => {
    feedLog.player('seek', { to: t });
    playerRef.current?.seek?.(t);
  }, [playerRef]);

  return { ...state, toggle, seek, progressElRef, detailProgressElRef, sheetProgressElRef };
}
