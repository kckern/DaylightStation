import { useEffect, useMemo } from 'react';
import useMenuMusic from './useMenuMusic.js';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { useIdentity } from '../identity/IdentityProvider';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * MenuMusicController — drives ambient menu music while gating it off whenever the
 * voice-memo overlay is up.
 *
 * Rendered INSIDE FitnessProvider (unlike the bare useMenuMusic call, which lived
 * in FitnessApp outside the provider) so it can read `voiceMemoOverlayState.open`.
 * The voice-memo overlay can be opened from browse screens AND session detail —
 * both contexts where menu music is otherwise playing — and it both records and
 * plays back audio, so the ambient bed must duck out of the way.
 *
 * Ducking is done by forcing useMenuMusic's `isActive` false while the overlay is
 * open: that reuses the hook's fade-to-0 + pause path, and on close `isActive`
 * returns true and the SAME track resumes (the isActive effect only picks a new
 * track when the slot has no src / has ended).
 */
const MenuMusicController = ({ isActive, trackChangeKey, volume, trackUrls }) => {
  const ctx = useFitnessContext();
  const voiceMemoOpen = !!ctx?.voiceMemoOverlayState?.open;

  // Emergency phase: 'normal' | 'triggering' | 'locked'. Anything other than
  // 'normal' means a shutdown ceremony / lockdown is on screen — the ambient
  // bed must get out of the way of the powerdown audio and the lockdown screen.
  const { phase: emergencyPhase } = useIdentity();
  const emergencyActive = emergencyPhase && emergencyPhase !== 'normal';

  const logger = useMemo(
    () => getLogger().child({ component: 'menu-music-controller' }),
    []
  );

  // Duck while a voice memo is being recorded/reviewed OR while an emergency
  // shutdown ceremony/lockdown is active. Both reuse useMenuMusic's fade-to-0 +
  // pause path; on return to 'normal' (e.g. an aborted shutdown) the SAME track
  // resumes (the isActive effect only picks a new track when the slot is empty).
  const effectiveActive = isActive && !voiceMemoOpen && !emergencyActive;

  useEffect(() => {
    if (isActive && voiceMemoOpen) {
      logger.debug('menu-music.ducked', { reason: 'voice-memo-overlay' });
    }
  }, [isActive, voiceMemoOpen, logger]);

  useEffect(() => {
    if (isActive && emergencyActive) {
      logger.info('menu-music.ducked', { reason: 'emergency', phase: emergencyPhase });
    }
  }, [isActive, emergencyActive, emergencyPhase, logger]);

  useMenuMusic({
    isActive: effectiveActive,
    trackChangeKey,
    volume,
    trackUrls,
  });

  return null;
};

export default MenuMusicController;
