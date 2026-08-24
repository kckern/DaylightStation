import { parentPort } from 'node:worker_threads';
import { chooseColumn } from '../../../../shared/gaming/rulesets/connect-four/opponent.mjs';

parentPort.on('message', ({ type, id, board, level }) => {
  if (type !== 'search') return;
  try {
    const column = chooseColumn(board, { player: 2, level });
    parentPort.postMessage({ type: 'bestmove', id, move: column === null ? null : { column } });
  } catch (error) {
    parentPort.postMessage({ type: 'failed', id, message: error?.message || String(error) });
  }
});
