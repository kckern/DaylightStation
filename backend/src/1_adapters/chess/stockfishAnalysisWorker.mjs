import { parentPort } from 'node:worker_threads';
import { loadEngineFactory } from './loadStockfish.mjs';

/**
 * The engine again, but asked a different question.
 *
 * `stockfishWorker.mjs` asks "what would a player of THIS strength play here?"
 * and throws the evaluation away. Review asks the opposite: full strength, no
 * skill handicap, and the SCORE is the answer — the move is incidental. Same
 * WASM, different UCI conversation, so it gets its own worker rather than a
 * mode flag on the play worker, whose whole contract is one bestmove out.
 *
 * Search runs to a fixed depth, not a fixed movetime: a review must be
 * reproducible across machines, and depth is the only knob that is.
 */

let engine = null;
let pending = null; // { id, depth } of the analysis the main thread awaits
let best = null;    // last `info` line's score + pv, kept until `bestmove` lands

function handleLine(raw) {
  const line = String(raw);

  if (line.startsWith('info')) {
    // Only depth-carrying pv lines are usable. Stockfish also emits
    // `info depth N currmove ...` progress lines with no score at all, and
    // reading those as "the evaluation" would return whatever the last
    // scored line happened to be, silently attributed to the wrong depth.
    if (!line.includes(' pv ')) return;
    const mateMatch = line.match(/score mate (-?\d+)/);
    const cpMatch = line.match(/score cp (-?\d+)/);
    if (!mateMatch && !cpMatch) return;
    const depthMatch = line.match(/ depth (\d+)/);
    const pvMatch = line.match(/ pv (\S+)/);
    best = {
      // Mate and cp are mutually exclusive per line, and a later line must be
      // able to REPLACE a mate score with a cp one (deeper search refuting a
      // shallow mate), so both are written every time — never merged into the
      // previous line's leftovers.
      cp: mateMatch ? null : Number(cpMatch[1]),
      mate: mateMatch ? Number(mateMatch[1]) : null,
      depth: depthMatch ? Number(depthMatch[1]) : null,
      pv: pvMatch ? pvMatch[1] : null,
    };
    return;
  }

  if (!line.startsWith('bestmove')) return;
  if (!pending) return;
  const { id } = pending;
  const uci = line.split(/\s+/)[1] || '';
  pending = null;
  // A terminal position (mate/stalemate on the board) produces `bestmove
  // (none)` and no scored info line at all. Report it as such rather than
  // inventing a score — the caller decides what a terminal node means.
  parentPort.postMessage({
    type: 'analysis',
    id,
    score: best,
    bestUci: uci && uci !== '(none)' ? uci : null,
  });
  best = null;
}

function handleMessage(msg) {
  if (msg.type !== 'analyse') return;
  pending = { id: msg.id };
  best = null;
  // Every analysed position is independent — this is not a game being played
  // forward, it is N unrelated probes — so each starts from a clean table.
  // Carrying one position's search over to the next would let an earlier
  // position's evaluation leak into a later one's.
  engine.sendCommand('ucinewgame');
  engine.sendCommand('setoption name UCI_LimitStrength value false');
  engine.sendCommand('setoption name Skill Level value 20');
  engine.sendCommand(`position fen ${msg.fen}`);
  engine.sendCommand(`go depth ${msg.depth}`);
}

// Same pre-boot queueing rationale as the play worker: the MessagePort listener
// is wired at module-eval time, but the WASM takes a few hundred ms to
// instantiate, so the first message reliably arrives while `engine` is null.
const preBootQueue = [];

parentPort.on('message', (msg) => {
  if (!engine) { preBootQueue.push(msg); return; }
  handleMessage(msg);
});

async function boot() {
  // The WASM prints a version banner straight to stdout on load, and a worker
  // shares the parent process's stdout. For the review CLI that stream is a
  // data channel — `--json` piped into a parser would choke on the banner — so
  // it is muted for the duration of the load. UCI output does not come through
  // console; it arrives on `engine.listener`, which is wired up below.
  const realLog = console.log;
  console.log = () => {};
  try {
    engine = await loadEngineFactory();
  } finally {
    console.log = realLog;
  }
  engine.listener = handleLine;
  engine.sendCommand('uci');
  engine.sendCommand('isready');
  parentPort.postMessage({ type: 'ready' });
  while (preBootQueue.length) handleMessage(preBootQueue.shift());
}

boot().catch((error) => {
  parentPort.postMessage({ type: 'boot-failed', message: error?.message || String(error) });
});
