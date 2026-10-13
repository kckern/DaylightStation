/**
 * useMatchRematch — the game-side half of `MatchGateContext`, as one hook.
 *
 * Every game on this kiosk has a "play again" of some shape: a button, an
 * any-key continue, a result card's onPlayAgain. All of them are the same
 * event — a MATCH BOUNDARY — and D12 says nothing reaches a match without
 * passing the gate. A gate that only stands at game ENTRY is a gate you pay
 * once and then replay past indefinitely, which is the whole failure this
 * wraps up.
 *
 * Hand it the game's own restart; it hands back a callback to use in its place:
 *
 *   const playAgain = useMatchRematch(game.startGame);
 *   useAnyKeyToContinue({ enabled: game.phase === 'GAME_OVER', activeNotes, onContinue: playAgain });
 *
 * Armed → the host is told, and the local restart does NOT run: the game is
 * about to be unmounted and the next match arrives as a fresh mount, so any
 * teardown or session-minting done here would belong to a match nobody plays.
 * That ordering is the point — it is why this wraps the restart rather than
 * sitting inside it.
 *
 * No provider (the office screen, PianoVisualizer, anywhere outside the kiosk)
 * or unarmed → the local restart runs, unchanged, with its arguments and its
 * return value passed straight through.
 *
 * The returned callback has a STABLE identity for the life of the component,
 * even though `localRestart` is usually rebuilt every render: it is handed to
 * `useAnyKeyToContinue` and to input controllers that arm listeners on it.
 *
 * Only ever route a path that is genuinely a boundary. Several games share one
 * `startGame` between "start the first run" and "run it again" — the first is
 * not a boundary (the gate already stood at entry) and gating it would toll the
 * child twice for one match. Where one callback serves both, say so with
 * `isBoundary`, which is re-read at call time:
 *
 *   const startRun = useMatchRematch(game.start, game.phase === 'complete');
 *
 * @param {Function} localRestart      what this game does at a boundary on its own.
 * @param {boolean}  [isBoundary=true] whether THIS call is a match boundary.
 */
import { useCallback, useContext, useRef } from 'react';
import MatchGateContext from '../../PianoKiosk/modes/Games/MatchGateContext.js';

export function useMatchRematch(localRestart, isBoundary = true) {
  const matchGate = useContext(MatchGateContext);
  const latest = useRef(null);
  latest.current = { matchGate, localRestart, isBoundary };

  return useCallback((...args) => {
    const { matchGate: gate, localRestart: restart, isBoundary: boundary } = latest.current;
    if (boundary && gate?.armed) {
      gate.requestRematch();
      return undefined;
    }
    return restart?.(...args);
  }, []);
}

export default useMatchRematch;
