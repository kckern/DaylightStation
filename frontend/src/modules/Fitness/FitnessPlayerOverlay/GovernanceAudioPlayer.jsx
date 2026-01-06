import React, { useEffect, useRef, useMemo } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';

/**
 * Lightweight audio player for governance overlay sounds.
 * Replaces the heavy Player component with a simple <audio> element.
 */

const AUDIO_TRACKS = {
  init: 'audio/sfx/bgmusic/fitness/start',
  locked: 'audio/sfx/bgmusic/fitness/locked'
};

const GovernanceAudioPlayer = React.memo(function GovernanceAudioPlayer({
  trackKey,
  volume = 0.85,
  loop = true
}) {
  const audioRef = useRef(null);
  const currentTrackRef = useRef(null);
  const playAttemptRef = useRef(null);

  // Memoize the audio source URL
  const audioSrc = useMemo(() => {
    if (!trackKey || !AUDIO_TRACKS[trackKey]) return null;
    return DaylightMediaPath(`/media/${AUDIO_TRACKS[trackKey]}.mp3`);
  }, [trackKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Cancel any pending play attempt
    if (playAttemptRef.current) {
      playAttemptRef.current = null;
    }

    // No track to play - pause and reset
    if (!audioSrc) {
      if (!audio.paused) {
        audio.pause();
      }
      audio.currentTime = 0;
      currentTrackRef.current = null;
      return;
    }

    // Same track already playing - just update volume
    if (currentTrackRef.current === audioSrc && !audio.paused) {
      audio.volume = Math.max(0, Math.min(1, volume));
      return;
    }

    // New track - load and play
    currentTrackRef.current = audioSrc;
    audio.src = audioSrc;
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.loop = loop;

    // Attempt to play (may fail due to autoplay policy)
    playAttemptRef.current = audio.play().catch((err) => {
      // Autoplay blocked is common - don't log as error
      if (err.name !== 'AbortError' && err.name !== 'NotAllowedError') {
        console.warn('[GovernanceAudioPlayer] Playback failed:', err.message);
      }
    });

    return () => {
      // Cleanup on unmount or track change
      if (playAttemptRef.current) {
        playAttemptRef.current = null;
      }
    };
  }, [audioSrc, volume, loop]);

  // Update volume when it changes (without reloading track)
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.volume = Math.max(0, Math.min(1, volume));
    }
  }, [volume]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      preload="auto"
      style={{ display: 'none' }}
      aria-hidden="true"
    />
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if trackKey changes or volume changes significantly
  if (prevProps.trackKey !== nextProps.trackKey) return false;
  if (Math.abs((prevProps.volume || 0.85) - (nextProps.volume || 0.85)) > 0.05) return false;
  if (prevProps.loop !== nextProps.loop) return false;
  return true;
});

GovernanceAudioPlayer.propTypes = {
  trackKey: PropTypes.oneOf(['init', 'locked', null]),
  volume: PropTypes.number,
  loop: PropTypes.bool
};

export default GovernanceAudioPlayer;
