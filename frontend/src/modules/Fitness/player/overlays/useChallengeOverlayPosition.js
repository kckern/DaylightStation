import { useCallback, useEffect, useState } from 'react';

export const CHALLENGE_OVERLAY_POSITION_KEY = 'fitness.challengeOverlay.position';
export const CHALLENGE_OVERLAY_POSITION_ORDER = ['top', 'middle', 'bottom'];

const readStored = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return CHALLENGE_OVERLAY_POSITION_ORDER[0];
  }
  try {
    const stored = window.localStorage.getItem(CHALLENGE_OVERLAY_POSITION_KEY);
    return CHALLENGE_OVERLAY_POSITION_ORDER.includes(stored)
      ? stored
      : CHALLENGE_OVERLAY_POSITION_ORDER[0];
  } catch (_) {
    return CHALLENGE_OVERLAY_POSITION_ORDER[0];
  }
};

const writeStored = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CHALLENGE_OVERLAY_POSITION_KEY, value);
  } catch (_) {}
};

export const useChallengeOverlayPosition = () => {
  const [position, setPosition] = useState(() => readStored());

  // Re-read on mount in case localStorage was set after the initial render.
  useEffect(() => {
    setPosition(readStored());
  }, []);

  const cyclePosition = useCallback(() => {
    setPosition((current) => {
      const idx = CHALLENGE_OVERLAY_POSITION_ORDER.indexOf(current);
      const next = CHALLENGE_OVERLAY_POSITION_ORDER[
        (idx + 1) % CHALLENGE_OVERLAY_POSITION_ORDER.length
      ];
      writeStored(next);
      return next;
    });
  }, []);

  return { position, cyclePosition };
};

export default useChallengeOverlayPosition;
