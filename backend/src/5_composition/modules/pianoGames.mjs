import { CONNECT_FOUR_OPPONENTS } from '#shared/gaming/rulesets/connect-four/opponent.mjs';
import { CHECKERS_OPPONENTS } from '#shared/gaming/rulesets/checkers/opponent.mjs';
import { DEFAULT_ROSTER as CHESS_OPPONENTS } from '#shared/gaming/rulesets/chess/ladder.mjs';
import { createConnectFourEngine } from '#adapters/piano-games/ConnectFourEngineAdapter.mjs';
import { createCheckersEngine } from '#adapters/piano-games/CheckersEngineAdapter.mjs';
import { createChessEngine } from '#adapters/piano-games/ChessEngineAdapter.mjs';
import { DataServicePianoGameRepository } from '#adapters/piano-games/DataServicePianoGameRepository.mjs';
import { PianoGamesContainer } from '#apps/piano-games/PianoGamesContainer.mjs';
import { createPianoGamesRouter } from '#api/v1/routers/pianoGames.mjs';

export function createPianoGamesModule({ dataService, configService, logger, nativeRouters = {} }) {
  const connectFourGateway = createConnectFourEngine({ logger: logger?.child?.({ module: 'connect-four-engine' }) });
  const checkersGateway = createCheckersEngine({ logger: logger?.child?.({ module: 'checkers-engine' }) });
  const chessGateway = createChessEngine({ logger: logger?.child?.({ module: 'chess-engine' }) });
  const repository = new DataServicePianoGameRepository({ dataService, configService });
  const container = new PianoGamesContainer({
    repository,
    logger,
    games: {
      'connect-four': {
        opponentGateway: connectFourGateway,
        opponents: CONNECT_FOUR_OPPONENTS,
        promotion: { winsRequired: 3, seriesLength: 5 },
      },
      checkers: {
        opponentGateway: checkersGateway,
        opponents: CHECKERS_OPPONENTS,
        promotion: { winsRequired: 3, seriesLength: 5 },
      },
      // Chess keeps its own, richer ladder rather than the 7-opponent/3-of-5
      // default: 21 rungs (one per Stockfish skill level) and 5-of-7, exactly
      // as `shared/gaming/rulesets/chess/ladder.mjs`'s DEFAULT_LADDER_POLICY has always
      // specified. helpCeilings MUST live inside `promotion` — recordGame()
      // constructs the ladder as `new OpponentLadder({ opponents, progress,
      // ...game.promotion })`, so a sibling `helpCeilings` key here would
      // never be spread in and the ceiling would silently stop gating
      // promotion. `unrestricted_below_level: 0` needs no 0-based/1-based
      // conversion (see OpponentLadder's class comment) because zero is the
      // same threshold — "no exemption" — in both numbering schemes; a
      // future non-zero value ported from chess's own policy would need +1.
      chess: {
        opponentGateway: chessGateway,
        opponents: CHESS_OPPONENTS,
        promotion: {
          winsRequired: 5,
          seriesLength: 7,
          helpCeilings: { max_hints: 1, max_best_moves: 0, max_takebacks: 1, unrestricted_below_level: 0 },
        },
      },
    },
  });
  const router = createPianoGamesRouter({ container, logger, nativeRouters });
  return { container, router };
}

export default createPianoGamesModule;
