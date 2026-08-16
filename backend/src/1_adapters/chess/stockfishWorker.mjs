import { parentPort } from 'node:worker_threads';
import { loadEngineFactory } from './loadStockfish.mjs';

/**
 * The engine, isolated from the event loop.
 *
 * A Stockfish search pins a thread for its whole movetime. On the main thread
 * that starves everything the backend serves — fitness, the player, screens —
 * in ~44ms chunks, so the engine lives here instead. UCI in, bestmove out.
 */

let engine = null;
let pending = null;   // { id } of the search the main thread is still waiting on
let drainNext = false; // swallow exactly one bestmove: the abandoned search's tail

function handleLine(raw) {
  const line = String(raw);
  if (!line.startsWith('bestmove')) return;
  const uci = line.split(/\s+/)[1] || '';
  // UCI does not tag a bestmove with the search that produced it, so "match the
  // id" cannot be done by inspection — an abandoned search's reply would simply
  // be attributed to whatever is pending when it lands. The abandon path arms
  // this flag instead, and the first bestmove after it is consumed silently.
  if (drainNext) { drainNext = false; return; }
  if (!pending) return;
  const { id } = pending;
  pending = null;
  parentPort.postMessage({ type: 'bestmove', id, uci });
}

let lastGameId = null;

function handleMessage(msg) {
  // Abandon: the main thread gave up on this search. Retire the id and tell the
  // engine to stop, so its late bestmove is dropped by handleLine above and the
  // next search starts from a quiet engine.
  if (msg.type === 'abandon') {
    // Only arm the drain if this search has NOT already replied. If pending is
    // null or holds a different id, its bestmove is already out and arming here
    // would swallow the next legitimate reply instead.
    if (pending?.id === msg.id) {
      pending = null;
      drainNext = true;
      engine.sendCommand('stop');
    }
    return;
  }
  if (msg.type !== 'search') return;
  pending = { id: msg.id };
  // A new game gets a clean transposition table; the same game does not, so the
  // engine keeps what it learned from the position it just looked at.
  if (msg.gameId !== lastGameId) {
    engine.sendCommand('ucinewgame');
    lastGameId = msg.gameId;
  }
  if (Number.isFinite(msg.elo)) {
    engine.sendCommand('setoption name UCI_LimitStrength value true');
    engine.sendCommand(`setoption name UCI_Elo value ${msg.elo}`);
  } else {
    engine.sendCommand('setoption name UCI_LimitStrength value false');
    engine.sendCommand(`setoption name Skill Level value ${msg.skill}`);
  }
  engine.sendCommand(`position fen ${msg.fen}`);
  engine.sendCommand(`go movetime ${msg.movetimeMs}`);
}

// The lite-single WASM takes a few hundred ms to compile and instantiate
// (boot() below is genuinely async), but parentPort.on('message') is wired
// up synchronously at module-eval time — long before that. A MessagePort
// queues messages posted before a listener exists, so a 'search' the main
// thread fires immediately after `new Worker(...)` reliably arrives here
// while `engine` is still null, not merely on some slow-boot edge case.
// Dropping it (the alternative: `if (!engine) return`) would silently lose
// the first search of every fresh worker's life, every time. Queue instead
// and replay once boot() resolves.
const preBootQueue = [];

parentPort.on('message', (msg) => {
  if (!engine) { preBootQueue.push(msg); return; }
  handleMessage(msg);
});

async function boot() {
  engine = await loadEngineFactory();
  engine.listener = handleLine;
  engine.sendCommand('uci');
  engine.sendCommand('isready');
  parentPort.postMessage({ type: 'ready' });
  while (preBootQueue.length) handleMessage(preBootQueue.shift());
}

boot().catch((error) => {
  parentPort.postMessage({ type: 'boot-failed', message: error?.message || String(error) });
});
