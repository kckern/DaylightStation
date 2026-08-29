import { CONNECT_FOUR_OPPONENTS } from '#shared/gaming/rulesets/connect-four/opponent.mjs';
import { CHECKERS_OPPONENTS } from '#shared/gaming/rulesets/checkers/opponent.mjs';
import { DEFAULT_ROSTER as CHESS_OPPONENTS } from '#shared/gaming/rulesets/chess/ladder.mjs';
import { createConnectFourEngine } from '#adapters/piano-games/ConnectFourEngineAdapter.mjs';
import { createCheckersEngine } from '#adapters/piano-games/CheckersEngineAdapter.mjs';
import { createChessEngine } from '#adapters/piano-games/ChessEngineAdapter.mjs';
import { DataServicePianoGameRepository } from '#adapters/piano-games/DataServicePianoGameRepository.mjs';
import { PianoGamesContainer } from '#apps/piano-games/PianoGamesContainer.mjs';
import { createPianoGamesRouter } from '#api/v1/routers/pianoGames.mjs';
import { OpponentDialogueService } from '#apps/piano-games/OpponentDialogueService.mjs';
import { checkersCommentary } from '#shared/gaming/rulesets/checkers/commentary.mjs';
import { connectFourCommentary } from '#shared/gaming/rulesets/connect-four/commentary.mjs';
import { chessCommentary } from '#shared/gaming/rulesets/chess/dialogueAdapter.mjs';
import { GameRivalryMemoryService } from '#apps/piano-games/GameRivalryMemoryService.mjs';

export function createPianoGamesModule({
  dataService, configService, logger, nativeRouters = {},
  boardGameDayService = null, aiGateway = null,
}) {
  const connectFourGateway = createConnectFourEngine({ logger: logger?.child?.({ module: 'connect-four-engine' }) });
  const checkersGateway = createCheckersEngine({ logger: logger?.child?.({ module: 'checkers-engine' }) });
  const chessGateway = createChessEngine({ logger: logger?.child?.({ module: 'chess-engine' }) });
  const repository = new DataServicePianoGameRepository({ dataService, configService });
  const games = {
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
      chess: {
        opponentGateway: chessGateway,
        opponents: CHESS_OPPONENTS,
        promotion: {
          winsRequired: 5,
          seriesLength: 7,
          helpCeilings: { max_hints: 1, max_best_moves: 0, max_takebacks: 1, unrestricted_below_level: 0 },
        },
      },
  };
  let container;
  const dialogue = new OpponentDialogueService({
    aiGateway,
    logger,
    readConfig: (gameId, userId) => repository.readConfig(gameId, userId),
    adapters: { 'connect-four': connectFourCommentary, checkers: checkersCommentary, chess: chessCommentary },
    resolveOpponent: (gameId, userId, requestedLevel) => container.resolveOpponent(gameId, userId, requestedLevel),
  });
  const rivalries = new GameRivalryMemoryService({
    readMemory: (gameId, userId) => repository.readRivalry(gameId, userId),
    writeMemory: (gameId, userId, memory) => repository.writeRivalry(gameId, userId, memory),
    readLegacy: (userId) => repository.readLegacyChessRivalry(userId),
    logger,
  });
  container = new PianoGamesContainer({
    repository,
    boardGameDayService,
    logger,
    dialogue,
    rivalries,
    // Constructed once above so dialogue and move authority share a ladder.
    games,
  });
  const router = createPianoGamesRouter({ pianoGames: container, logger, nativeRouters });
  return { container, router };
}

export default createPianoGamesModule;
