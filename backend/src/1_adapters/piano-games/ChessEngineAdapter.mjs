import { createGame, playMove } from '../../../../shared/gaming/rulesets/chess/engine.mjs';
import { DEFAULT_LADDER_POLICY, rungForLevel } from '../../../../shared/gaming/rulesets/chess/ladder.mjs';
import { createStockfishEngine } from '../chess/StockfishEngineAdapter.mjs';

/**
 * Rebuilds the position a container-driven chess request is asking a move
 * for, from a transcript rather than a client-supplied FEN.
 *
 * Connect Four and Checkers already refuse to trust a client's board state —
 * `replayGame(transcript)` reconstructs it from the move list instead — and
 * this keeps chess to the same discipline on the unified container's surface.
 * The native Piano endpoint may additionally accept a FEN for its richer
 * analysis workflow; this opponent gateway accepts only the authoritative
 * transcript used by the common Piano game container. A transcript is
 * `{ initial_fen, moves }` — `moves` a list of SAN strings (or
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
 * class comment). `rungForLevel` uses a zero-based table and may select either
 * the deterministic teaching engine or Stockfish. The `- 1` below is the one
 * place this adapter converts between those numbering systems.
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
