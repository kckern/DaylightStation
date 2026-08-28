/**
 * Gate ids — the shared vocabulary of `GateVerdict.id`.
 *
 * A gate id crosses a module boundary twice and is checked by nothing on the
 * way: a governor writes it into its verdict, `resolvePause` copies it to
 * `PauseDecision.gate`, and some other file — one that never imports the
 * governor — compares against it. Fitness did exactly that with two bare
 * `'governance'` literals twelve lines apart, which worked only because they
 * were within eyeshot of each other. The second gate (school checkpoints) is
 * produced and consumed in different directories, so the literals stop being
 * within eyeshot and become drift.
 *
 * The values are the strings already in the log store (`PauseDecision.gate`),
 * so this file names what shipped rather than renaming it; changing a value
 * here breaks every saved query.
 */

export const GATE_ID = Object.freeze({
  GOVERNANCE: 'governance',
  CHECKPOINT: 'checkpoint',
  /**
   * A REQUIRED lesson companion (`ReadalongPlaylistPlayer`). Unlike the two
   * above it never blocks — it publishes only a `seekCeiling`, so a child may
   * rewind and re-listen without limit and only a jump PAST the furthest point
   * they actually reached is refused. Because `mediaGate` names a gate in its
   * clamp log from the BLOCKING gate, a clamp attributed to this one logs
   * `gate: null`; the injected child logger's `component` is what identifies it.
   */
  COMPANION: 'companion'
});

export default GATE_ID;
