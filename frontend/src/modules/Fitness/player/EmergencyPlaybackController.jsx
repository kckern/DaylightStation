import { useEffect, useMemo, useRef } from 'react';
import { useFitness } from '@/context/FitnessContext.jsx';
import { useIdentity } from '../identity/IdentityProvider';
import getLogger from '@/lib/logging/Logger.js';

/**
 * EmergencyPlaybackController — pauses session playback (the workout video AND the
 * in-workout music) whenever an emergency shutdown ceremony / lockdown screen is on
 * top, and resumes it once the emergency clears (e.g. an aborted shutdown returns to
 * 'normal').
 *
 * Separation of concerns: the Player modules know nothing about emergencies. They
 * expose a generic "external pause" interface via FitnessContext.videoPlayerPaused —
 * FitnessPlayer pauses/resumes the video on it, and FitnessMusicPlayer pauses/resumes
 * the in-workout music on it (shouldPause = videoPlayerPaused || voiceMemoOpen). This
 * controller is the only emergency-aware piece; it drives that generic flag, mirroring
 * MenuMusicController which ducks the ambient menu bed on the same phase.
 *
 * The Player is never unmounted while the overlay is up, so the queue/position survive
 * — an aborted shutdown resumes playback exactly where it paused.
 */
const EmergencyPlaybackController = () => {
  const { phase: emergencyPhase } = useIdentity();
  const { setVideoPlayerPaused } = useFitness() || {};
  const emergencyActive = Boolean(emergencyPhase && emergencyPhase !== 'normal');

  const logger = useMemo(
    () => getLogger().child({ component: 'emergency-playback' }),
    []
  );

  // Only undo the pause we applied, so we never clear a pause that another owner
  // (e.g. an open voice memo) is still holding.
  const pausedByUsRef = useRef(false);

  useEffect(() => {
    if (typeof setVideoPlayerPaused !== 'function') return;
    if (emergencyActive) {
      if (!pausedByUsRef.current) {
        pausedByUsRef.current = true;
        setVideoPlayerPaused(true);
        logger.info('emergency.playback_paused', { phase: emergencyPhase });
      }
    } else if (pausedByUsRef.current) {
      pausedByUsRef.current = false;
      setVideoPlayerPaused(false);
      logger.info('emergency.playback_resumed', { phase: emergencyPhase });
    }
  }, [emergencyActive, emergencyPhase, setVideoPlayerPaused, logger]);

  return null;
};

export default EmergencyPlaybackController;
