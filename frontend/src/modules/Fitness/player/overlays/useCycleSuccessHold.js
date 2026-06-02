import { useEffect, useRef, useState } from 'react';
import { CHALLENGE_SUCCESS_HOLD_MS } from './ChallengeOverlay.jsx';

/**
 * useCycleSuccessHold(challenge)
 *
 * Keeps the cycle challenge overlay visible for a brief celebratory window when
 * a cycle challenge succeeds — the cycle-side port of the HR challenge's
 * success hold (✅ + completion ring) in useChallengeMachine. Without it the
 * cycle overlay vanishes the instant status flips to 'success'.
 *
 * Captures the success snapshot at the transition tick so the hold survives the
 * engine nulling the live challenge. Each challenge id triggers the hold at most
 * once, so the animation never loops while the engine keeps reporting success.
 *
 * @param {Object|null} challenge - cycle challenge snapshot (governance state)
 * @returns {{ done: boolean, challenge: Object|null }}
 */
export function useCycleSuccessHold(challenge) {
  const [held, setHeld] = useState(null); // { id, challenge } during the hold window
  const seenRef = useRef(new Set());      // challenge ids already held (no re-fire)
  const timerRef = useRef(null);

  const id = challenge?.id ?? null;
  const status = challenge?.status ?? null;

  useEffect(() => {
    if (status !== 'success' || id == null) return;
    if (seenRef.current.has(id)) return;
    seenRef.current.add(id);
    setHeld({ id, challenge });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setHeld((curr) => (curr && curr.id === id ? null : curr));
    }, CHALLENGE_SUCCESS_HOLD_MS);
    // challenge is intentionally read at the success-transition tick only; the
    // captured snapshot is frozen for the hold window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, status]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { done: held != null, challenge: held?.challenge ?? null };
}

export default useCycleSuccessHold;
