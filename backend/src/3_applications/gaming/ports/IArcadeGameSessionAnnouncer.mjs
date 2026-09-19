/**
 * Publishes arcade-game-session facts so other parts of the house can react — the
 * economy burns purchased time, the on-screen overlay counts down, the fleet
 * view shows what is being played.
 *
 * Announcing is best-effort and must never be able to fail a session: losing a
 * broadcast is a visibility problem, whereas losing the session is a money
 * problem. Implementations swallow transport errors and log them.
 */
export class IArcadeGameSessionAnnouncer {
  async started(_session) { throw new Error('IArcadeGameSessionAnnouncer.started must be implemented'); }
  async progress(_session, _observation) { throw new Error('IArcadeGameSessionAnnouncer.progress must be implemented'); }
  async ended(_session) { throw new Error('IArcadeGameSessionAnnouncer.ended must be implemented'); }
}
