// frontend/src/modules/Player/components/MusicBehindLayer.jsx
//
// Music behind a slideshow (RQ-PLAY-12): a second, AUXILIARY Player that plays
// a song, album or playlist under the photos and is steered on its own —
// skipping a photo never skips a song. Used by screens
// (ScreenPlayerFeaturesHost) and by the Media app on this device
// (Media/session/MusicBehindHost). The Player is parked off-screen, never
// display:none (a hidden media element is throttled or refused playback).
import React, { useEffect, useImperativeHandle, useMemo, useRef, forwardRef } from 'react';
import Player from '../Player.jsx';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'MusicBehindLayer' });
  return _logger;
}

const POLL_MS = 1000;
const PARKED = {
  position: 'fixed', left: '-10000px', top: 0, width: '1px', height: '1px', overflow: 'hidden', pointerEvents: 'none',
};

/**
 * @param {string} contentId   song, album or playlist
 * @param {string} [title]     its name, for the published state
 * @param {(state) => void} onState  { contentId, title, state: loading|playing|paused, trackTitle }
 * @param {() => void} onEnded       the music ran out
 * ref → { play, pause, next, prev }
 */
export const MusicBehindLayer = forwardRef(function MusicBehindLayer({ contentId, title = null, onState, onEnded }, ref) {
  const playerRef = useRef(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  // Stable per contentId: a fresh queue object each render would remount the Player.
  const queue = useMemo(() => ({ contentId }), [contentId]);

  useImperativeHandle(ref, () => ({
    play: () => playerRef.current?.play?.(),
    pause: () => playerRef.current?.pause?.(),
    next: () => playerRef.current?.advance?.(1),
    prev: () => playerRef.current?.advance?.(-1),
  }), []);

  useEffect(() => {
    logger().info('music-behind.mounted', { contentId });
    let last = null;
    const tick = () => {
      const player = playerRef.current;
      const el = player?.getMediaElement?.();
      const item = player?.getNowPlaying?.()?.item ?? null;
      const next = {
        contentId, title,
        state: !el ? 'loading' : el.paused ? 'paused' : 'playing',
        trackTitle: item?.title ?? null,
      };
      const key = `${next.state}|${next.trackTitle}`;
      if (key === last) return;
      if (last) logger().debug('music-behind.state', { contentId, state: next.state, trackTitle: next.trackTitle });
      last = key;
      try { onStateRef.current?.(next); } catch (err) { logger().warn('music-behind.on-state-threw', { error: err?.message }); }
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { clearInterval(timer); logger().info('music-behind.unmounted', { contentId }); };
  }, [contentId, title]);

  return (
    <div style={PARKED} aria-hidden="true" data-testid="music-behind-layer" data-content-id={contentId}>
      <Player
        ref={playerRef}
        auxiliary
        ignoreKeys
        playerType="background"
        queue={queue}
        clear={onEnded}
      />
    </div>
  );
});

export default MusicBehindLayer;
