import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayGame } from '../../../../shared/gaming/rulesets/connect-four/engine.mjs';
import { chooseColumn } from '../../../../shared/gaming/rulesets/connect-four/opponent.mjs';
import { createSerializedWorkerOpponent } from './SerializedWorkerOpponent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Worker-backed, serialized Connect Four opponent modeled on StockfishEngineAdapter. */
export function createConnectFourEngine({
  workerPath = path.join(HERE, 'connectFourWorker.mjs'), logger = null, timeoutMs = 1000,
} = {}) {
  const workerOpponent = createSerializedWorkerOpponent({
    workerPath, logger, logPrefix: 'connect-four.engine', timeoutMs,
  });

  return {
    async chooseMove({ transcript, level = 1 }) {
      const game = replayGame(transcript);
      if (!game.valid || game.status.gameOver || game.turn !== 2) return null;
      const startedAt = Date.now();
      const result = await workerOpponent.search({ board: game.board, level });
      let column = result?.column ?? null;
      let engine = 'worker';
      if (column === null) {
        column = chooseColumn(game.board, { player: 2, level });
        engine = 'fallback';
      }
      return column === null ? null : { column, engine, thinkingMs: Date.now() - startedAt };
    },
    dispose() {
      workerOpponent.dispose();
    },
  };
}

export default { createConnectFourEngine };
