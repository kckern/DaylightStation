/**
 * makeCloseGuard — single-shot acquire/reset helper for the FitnessPlayer close
 * flow. Prevents executeClose from firing twice when both the voice-memo
 * onComplete callback AND the overlay-transition useEffect race to invoke it
 * after the same close gesture (each would otherwise trigger its own
 * onSessionEndRedirect navigation).
 *
 * @returns {{ acquire: (sessionId?: string|null) => boolean, reset: () => void, heldFor: () => string|null }}
 */
export function makeCloseGuard() {
  let held = false;
  let sessionId = null;
  return {
    acquire(sid) {
      if (held) return false;
      held = true;
      sessionId = sid ?? null;
      return true;
    },
    reset() {
      held = false;
      sessionId = null;
    },
    heldFor() {
      return sessionId;
    },
  };
}

export default makeCloseGuard;
