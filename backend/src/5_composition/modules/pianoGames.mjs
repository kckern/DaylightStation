import { CONNECT_FOUR_OPPONENTS } from '#shared/gaming/connect-four/opponent.mjs';
import { CHECKERS_OPPONENTS } from '#shared/gaming/checkers/opponent.mjs';
import { createConnectFourEngine } from '#adapters/piano-games/ConnectFourEngineAdapter.mjs';
import { createCheckersEngine } from '#adapters/piano-games/CheckersEngineAdapter.mjs';
import { DataServicePianoGameRepository } from '#adapters/piano-games/DataServicePianoGameRepository.mjs';
import { PianoGamesContainer } from '#apps/piano-games/PianoGamesContainer.mjs';
import { createPianoGamesRouter } from '#api/v1/routers/pianoGames.mjs';

export function createPianoGamesModule({ dataService, configService, logger, compatibilityRouters = {} }) {
  const connectFourGateway = createConnectFourEngine({ logger: logger?.child?.({ module: 'connect-four-engine' }) });
  const checkersGateway = createCheckersEngine({ logger: logger?.child?.({ module: 'checkers-engine' }) });
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
    },
  });
  // Transitional aliases let clients adopt the unified namespace before a
  // mature game's application service is replaced. The legacy URI remains live.
  const router = createPianoGamesRouter({ container, logger, compatibilityRouters });
  return { container, router };
}

export default createPianoGamesModule;
