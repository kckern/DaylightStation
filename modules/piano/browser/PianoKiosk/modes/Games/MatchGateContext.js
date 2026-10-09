/**
 * MatchGateContext — the seam between a game's "play again" and the challenge
 * that stands at a match boundary (D7/D11).
 *
 * A game knows when one match ends and the next begins; it is the only thing
 * that does. It does NOT know whether a gate stands there, what the gate asks
 * for, or how the host mounts it — and it must not learn, because the same
 * components render on the office screen, inside PianoVisualizer, with no kiosk
 * around them at all. So the game announces the boundary and the host decides
 * what happens at it.
 *
 * The value:
 *   `armed`          — is there a gate at this boundary right now?
 *   `requestRematch` — I am at a match boundary; take it from here.
 *   `registerCompletion` — hold that boundary until its durable receipt lands.
 *
 * The game-side contract is three lines, and the `?.` is load-bearing:
 *
 *   const matchGate = useContext(MatchGateContext);
 *   // …in the restart path, before any local reset:
 *   if (matchGate?.armed) { matchGate.requestRematch(); return; }
 *
 * `null` is the default for exactly that reason — a game mounted outside the
 * kiosk gets no provider, reads `null`, and restarts itself exactly as it
 * always has. An `undefined` default would read the same, but declaring the
 * absence deliberately is what makes "no provider" a supported state rather
 * than an accident.
 *
 * Why the game returns EARLY rather than restarting and letting the host
 * interrupt: when the gate is armed the host unmounts the game and mounts the
 * challenge in its place. Any local reset done first would mint a seed and a
 * session id for a match nobody plays, and — for a family that archives on
 * unmount — file that phantom match as abandoned.
 */
import { createContext } from 'react';

const MatchGateContext = createContext(null);

export default MatchGateContext;
