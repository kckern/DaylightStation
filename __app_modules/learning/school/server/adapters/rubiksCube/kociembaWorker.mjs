import { parentPort } from 'node:worker_threads';
import Cube from 'cubejs';

let ready = false;
parentPort.on('message', ({ id, facelets }) => {
  try {
    if (!ready) { Cube.initSolver(); ready = true; }
    const solution = Cube.fromString(facelets).solve();
    parentPort.postMessage({ id, ok: true, moves: solution.trim() ? solution.trim().split(/\s+/) : [] });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error.message || 'The recovery solver could not solve this cube.' });
  }
});
