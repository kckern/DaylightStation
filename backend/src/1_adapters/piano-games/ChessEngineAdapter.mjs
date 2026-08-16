import { createGame, playMove } from '../../../../shared/gaming/chess/engine.mjs';
import { DEFAULT_LADDER_POLICY, rungForLevel } from '../../../../shared/gaming/chess/ladder.mjs';
import { createStockfishEngine } from '../chess/StockfishEngineAdapter.mjs';

/**
 * Rebuilds the position a container-driven chess request is asking a move
 * for, from a transcript rather than a client-supplied FEN.
 *
 * Connect Four and Checkers already refuse to trust a client's board state —
 * `replayGame(transcript)` reconstructs it from the move list instead — and
 * this keeps chess to the same discipline on the unified container's surface.
 * That is a real change of trust boundary from chess's existing behaviour
 * (`chess.mjs` takes `fen` straight from the request body), but the deployed
 * kiosk still talks to that unchanged compatibility mount; nothing standing
 * between a client and this adapter today sends live traffic through it. A
 * transcript is `{ initial_fen, moves }` — `moves` a list of SAN strings (or
 * `{from,to,promotion}` objects; `playMove` accepts either) — mirroring the
 * `{ initial_fen, fen, moves }` shape `chessGameState.js` already keeps on the
 * client, minus the derived `fen`.
 *
 * A transcript that fails to replay (an illegal move, a corrupt initial_fen)
 * resolves to `null` rather than throwing — the same "no move" outcome
 * `replayGame` produces for an invalid Connect Four/Checkers transcript —
 * so a malformed request degrades to "the opponent has nothing to say"
 * instead of a 500 the caller has to specifically catch.
 */
function fenFromTranscript(transcript) {
  const initialFen = transcript?.initial_fen;
  let game = createGame(initialFen ? { fen: initialFen } : {});
  if (!game) return null;
  for (const move of transcript?.moves || []) {
    const result = playMove(game, move);
    if (result.error) return null;
    game = result.game;
  }
  return game.fen;
}

/**
 * Wraps the existing Stockfish adapter behind `IGameOpponentGateway`, so
 * chess can sit in `PianoGamesContainer`'s `games` map next to Connect Four
 * and Checkers.
 *
 * `opponent` arrives already resolved by `OpponentLadder.resolve()`, whose
 * levels are 1-based (the first rung is level 1 — see `OpponentLadder`'s
 * class comment). Stockfish's own Skill Level option, and `rungForLevel`
 * (the shared chess ladder's existing level -> engine-settings lookup,
 * reused here rather than re-implemented) both count from 0. The `- 1` below
 * is the one and only place this adapter converts between the two systems,
 * so a future numbering change has a single call site to fix rather than a
 * scattered off-by-one hunt.
 *
 * `engine` is accepted for injection (a fake with `chooseMove`/`dispose`)
 * so the level-to-skill mapping and replay-failure paths can be tested
 * without spinning up a real Stockfish worker; production wiring leaves it
 * to default to a real `createStockfishEngine`.
 */
export function createChessEngine({
  workerPath, logger = null, timeoutMarginMs, policy = DEFAULT_LADDER_POLICY,
  engine = createStockfishEngine({ workerPath, logger, timeoutMarginMs }),
} = {}) {
  return {
    async chooseMove({ transcript, gameSessionId, opponent }) {
      const fen = fenFromTranscript(transcript);
      if (!fen) return null;
      const skill = Math.max(0, Number(opponent?.level || 1) - 1);
      const rung = rungForLevel(skill, policy);
      return engine.chooseMove({ fen, rung, gameId: gameSessionId });
    },
    dispose() {
      engine.dispose?.();
    },
  };
}

export default { createChessEngine };
