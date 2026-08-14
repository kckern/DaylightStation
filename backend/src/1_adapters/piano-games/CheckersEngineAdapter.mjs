import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayGame } from '../../../../shared/gaming/checkers/engine.mjs';
import { chooseMove } from '../../../../shared/gaming/checkers/opponent.mjs';
import { createSerializedWorkerOpponent } from './SerializedWorkerOpponent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function createCheckersEngine({
  workerPath = path.join(HERE, 'checkersWorker.mjs'), logger = null, timeoutMs = 2500,
} = {}) {
  const workerOpponent = createSerializedWorkerOpponent({
    workerPath, logger, logPrefix: 'checkers.engine', timeoutMs,
  });
  return {
    async chooseMove({ transcript, level = 1 }) {
      const game = replayGame(transcript);
      if (!game.valid || game.status.gameOver || game.turn !== 2) return null;
      const startedAt = Date.now();
      let move = await workerOpponent.search({ game, level });
      let engine = 'worker';
      if (!move) {
        // A worker failure must not move the expensive search onto the API
        // event loop. The shallow fallback is intentionally quick and honest.
        move = chooseMove(game, { level: Math.min(2, Number(level) || 1) });
        engine = 'fallback';
      }
      return move ? { ...move, engine, thinkingMs: Date.now() - startedAt } : null;
    },
    dispose() { workerOpponent.dispose(); },
  };
}

export default { createCheckersEngine };
