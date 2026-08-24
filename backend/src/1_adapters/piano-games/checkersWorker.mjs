import { parentPort } from 'node:worker_threads';
import { chooseMove } from '../../../../shared/gaming/rulesets/checkers/opponent.mjs';

parentPort.on('message', ({ type, id, game, level }) => {
  if (type !== 'search') return;
  try {
    parentPort.postMessage({ type: 'bestmove', id, move: chooseMove(game, { level }) });
  } catch (error) {
    parentPort.postMessage({ type: 'failed', id, message: error?.message || String(error) });
  }
});
