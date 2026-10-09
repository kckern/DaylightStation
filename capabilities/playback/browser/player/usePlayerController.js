import { useCallback } from 'react';

/**
 * usePlayerController
 * Given a ref returned from <Player ref={...} />, provides stable helpers
 * so consuming components don't reach into DOM directly.
 */
export default function usePlayerController(playerRef) {
  const getMediaEl = () => playerRef?.current?.getMediaElement?.() || null;

  const play = useCallback(() => {
    const api = playerRef?.current; if (!api) return; api.play?.();
  }, [playerRef]);
  const pause = useCallback(() => {
    const api = playerRef?.current; if (!api) return; api.pause?.();
  }, [playerRef]);
  const toggle = useCallback(() => {
    const api = playerRef?.current; if (!api) return; api.toggle?.();
  }, [playerRef]);
  const seek = useCallback((t) => {
    const api = playerRef?.current; if (!api || !Number.isFinite(t)) return; api.seek?.(t);
  }, [playerRef]);
  const getCurrentTime = useCallback(() => {
    const api = playerRef?.current; return api?.getCurrentTime?.() || 0;
  }, [playerRef]);
  const getDuration = useCallback(() => {
    const api = playerRef?.current; return api?.getDuration?.() || 0;
  }, [playerRef]);

  return { play, pause, toggle, seek, getCurrentTime, getDuration, getMediaEl };
}
