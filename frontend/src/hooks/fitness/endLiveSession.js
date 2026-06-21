/**
 * End the live in-browser FitnessSession deliberately (user pressed "End Session").
 * Reason 'user_initiated' marks the session finalized and (via FitnessSession)
 * bypasses the auto-start cooldown so a subsequent workout can begin immediately.
 *
 * @param {{ sessionId: (string|null), endSession: (reason: string) => boolean } | null} session
 * @returns {boolean} true if a session was actually ended
 */
export function endLiveSession(session) {
  if (!session || !session.sessionId) return false;
  return session.endSession('user_initiated');
}

export default endLiveSession;
