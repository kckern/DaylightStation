import { useVisibleRefresh, whileDocumentVisible } from '@/lib/hooks/useVisibleRefresh.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { feedLog } from "../feedLog.js";

// All Feed controls display the persistent player's clock, even as routes change.
const idlePlayback = { playing: false, currentTime: 0, duration: 0 };

export function usePlaybackObserver(playerRef, active, selectedContentId = null) {
  const [state, setState] = useState(idlePlayback);
  const progressElRef = useRef(null);
  const detailProgressElRef = useRef(null);
  const sheetProgressElRef = useRef(null);
  const lastPlaying = useRef(null);
  const missingPlayerLogged = useRef(false);
  const getSelectedPlayer = useCallback(() => {
    const player = playerRef.current;
    if (!player || (selectedContentId && player.getMountedContentId?.() !== selectedContentId)) return null;
    return player;
  }, [playerRef, selectedContentId]);

  const sample = useCallback(() => {
    const player = getSelectedPlayer();
    if (!player) {
      if (!missingPlayerLogged.current) feedLog.player('poll: playerRef.current is null');
      missingPlayerLogged.current = true;
      lastPlaying.current = null;
      setState(previous => previous.contentId === selectedContentId && !previous.playing && !previous.currentTime && !previous.duration
        ? previous : { ...idlePlayback, contentId: selectedContentId });
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
    setState(previous => previous.contentId === selectedContentId && previous.playing === playing && previous.currentTime === currentTime && previous.duration === duration
      ? previous : { contentId: selectedContentId, playing, currentTime, duration });
  }, [getSelectedPlayer, selectedContentId]);
  useVisibleRefresh({ active, intervalMs: 500, reload: sample });

  useEffect(() => {
    lastPlaying.current = null;
    missingPlayerLogged.current = false;
    if (!active) {
      feedLog.player('observer inactive — resetting state');
      setState(idlePlayback);
      return;
    }
    setState({ ...idlePlayback, contentId: selectedContentId });
    feedLog.player('observer active — starting 500ms poll');
    return whileDocumentVisible(() => {
      let frame;
      function paint() {
        const player = getSelectedPlayer();
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
  }, [active, getSelectedPlayer, playerRef, selectedContentId]);

  const toggle = useCallback(() => {
    feedLog.player('toggle');
    getSelectedPlayer()?.toggle?.();
  }, [getSelectedPlayer]);

  const seek = useCallback((t) => {
    feedLog.player('seek', { to: t });
    getSelectedPlayer()?.seek?.(t);
  }, [getSelectedPlayer]);

  const visibleState = active && state.contentId === selectedContentId ? state : idlePlayback;
  return { ...visibleState, toggle, seek, progressElRef, detailProgressElRef, sheetProgressElRef };
}
