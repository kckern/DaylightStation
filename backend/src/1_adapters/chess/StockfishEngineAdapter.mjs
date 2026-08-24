import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { applyMove, legalMoves } from '../../../../shared/gaming/rulesets/chess/engine.mjs';
import { chooseMove as homegrownChooseMove } from '../../../../shared/gaming/rulesets/chess/opponent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ELO_FLOOR = 1320;
const ELO_CEILING = 3190;

/** UCI ('e2e4', 'e7e8q') -> the move object the game state layer expects. */
function fromUci(fen, uci) {
  if (!uci || uci === '(none)' || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  const result = applyMove(fen, { from, to, ...(promotion ? { promotion } : {}) });
  if (!result?.move) return null;
  return { from, to, ...(promotion ? { promotion } : {}), san: result.move.san };
}

/**
 * Does this rung want the homegrown teaching opponent rather than Stockfish?
 *
 * The bottom of the ladder does, because Stockfish cannot go low enough — its
 * weakest setting measured far stronger than the children it was meant to
 * teach. See `DEFAULT_LEVEL_RUNGS` for the measurements.
 *
 * This says nothing about ANALYSIS. Hints, best-move reveals and post-game
 * review always run full-strength Stockfish through
 * `StockfishAnalysisAdapter` — a hint only as strong as a beginner's opponent
 * would not be a hint. Only the opponent is weakened here.
 */
export function isHomegrownRung(rung) {
  return rung?.engine === 'homegrown';
}

/**
 * Resolve a rung to engine options. skill and elo are different mechanisms and
 * cannot both apply: UCI_Elo makes the engine target a rating and ignore Skill
 * Level entirely, so a rung carrying both is a config error.
 */
export function engineOptionsForRung(rung, logger) {
  const movetimeMs = Number(rung?.movetime_ms) > 0 ? Number(rung.movetime_ms) : 200;
  // `!= null` excludes null/undefined before the Number() coercion — Number(null)
  // is 0, which is finite, so a YAML rung with an empty `elo:`/`skill:` key would
  // otherwise read as "elo 0" (clamped to the 1320 floor with a misleading
  // elo-clamped warning) instead of "no elo specified".
  const hasElo = rung?.elo != null && Number.isFinite(Number(rung.elo));
  const hasSkill = rung?.skill != null && Number.isFinite(Number(rung.skill));
  if (hasElo && hasSkill) {
    logger?.warn?.('chess.rung.skill-and-elo', { rung: rung.id, honoured: 'elo' });
  }
  if (hasElo) {
    const raw = Number(rung.elo);
    const elo = Math.min(ELO_CEILING, Math.max(ELO_FLOOR, raw));
    if (elo !== raw) logger?.warn?.('chess.rung.elo-clamped', { rung: rung.id, requested: raw, elo });
    return { movetimeMs, elo };
  }
  return { movetimeMs, skill: hasSkill ? Math.min(20, Math.max(0, Number(rung.skill))) : 3 };
}

/**
 * Which homegrown level stands in when the engine is unreachable.
 *
 * The bundled engine's rungs are beginner/learner/steady. Handing a child on
 * "First moves" the strongest of the three because a wasm failed to load is a
 * worse failure than no opponent at all: the rail still says First moves.
 */
export function fallbackDifficultyFor(rung, options) {
  if (Number.isFinite(options?.elo)) return 'steady';
  const skill = Number.isFinite(options?.skill) ? options.skill : 3;
  if (skill <= 2) return 'beginner';
  if (skill <= 10) return 'learner';
  return 'steady';
}

export function createStockfishEngine({
  workerPath = path.join(HERE, 'stockfishWorker.mjs'),
  logger = null,
  timeoutMarginMs = 1500,
} = {}) {
  let worker = null;
  let workerUsable = true;
  let queue = Promise.resolve();
  let nextId = 1;
  const waiting = new Map();

  function ensureWorker() {
    if (worker || !workerUsable) return worker;
    try {
      worker = new Worker(workerPath);
      worker.on('message', (msg) => {
        if (msg.type === 'bestmove') waiting.get(msg.id)?.resolve(msg.uci);
        if (msg.type === 'boot-failed') {
          workerUsable = false;
          logger?.warn?.('chess.engine.boot-failed', { message: msg.message });
          for (const entry of waiting.values()) entry.resolve(null);
          // Without this, `worker` stays non-null and ensureWorker()'s
          // `if (worker || !workerUsable) return worker;` hands back the same
          // dead-but-alive handle forever: every later search posts into it,
          // waits out the full movetime_ms + timeoutMarginMs, and only then
          // falls back — the exact permanent per-move latency tax the 'exit'
          // handler above already exists to avoid — plus an orphaned thread
          // for the life of the process.
          worker?.terminate?.();
          worker = null;
        }
      });
      worker.on('error', (error) => {
        // Recoverable: drop the worker and let the next search respawn it. A
        // process-lifetime latch would mean one transient crash silently demotes
        // chess to the fallback engine until the next deploy.
        logger?.warn?.('chess.engine.worker-error', { message: error?.message });
        for (const entry of waiting.values()) entry.resolve(null);
        worker?.terminate?.();
        worker = null;
      });
      // A worker can exit without ever emitting 'error'. Without this the handle
      // stays non-null, every later search posts into a dead port and waits out
      // the full timeout before falling back — a permanent per-move latency tax
      // whose only symptom is a stream of chess.engine.timeout warnings.
      worker.on('exit', () => {
        for (const entry of waiting.values()) entry.resolve(null);
        worker = null;
      });
      worker.unref?.();
    } catch (error) {
      workerUsable = false;
      logger?.warn?.('chess.engine.worker-spawn-failed', { message: error?.message });
      worker = null;
    }
    return worker;
  }

  function search({ fen, gameId, options }) {
    const live = ensureWorker();
    if (!live) return Promise.resolve(null);
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        // Tell the engine to stop and retire the id BEFORE the queue releases the
        // next search, or that search inherits this one's late bestmove.
        live.postMessage({ type: 'abandon', id });
        logger?.warn?.('chess.engine.timeout', { movetimeMs: options.movetimeMs });
        resolve(null);
      }, options.movetimeMs + timeoutMarginMs);
      waiting.set(id, {
        resolve: (uci) => { clearTimeout(timer); waiting.delete(id); resolve(uci); },
      });
      live.postMessage({ type: 'search', id, fen, gameId, ...options });
    });
  }

  return {
    /** Resolves the opponent's reply, or null when there are no legal moves. */
    async chooseMove({ fen, rung, gameId }) {
      if (legalMoves(fen).length === 0) return null;

      // The bottom rungs are not Stockfish at all. Routed here rather than in a
      // separate adapter because the caller asks one question — "what does this
      // rung play?" — and which engine answers it is this layer's business, not
      // the router's.
      if (isHomegrownRung(rung)) {
        const startedAt = Date.now();
        const move = homegrownChooseMove(fen, {
          depth: rung.depth,
          blunder_rate: rung.blunder_rate,
          // Seeded by position so a rung is deterministic: the same board always
          // draws the same reply, which is what makes a rung reproducible in a
          // calibration run and in a test.
          seed: fen.length,
        });
        if (!move) return null;
        logger?.info?.('chess.engine.move', {
          rung: rung?.id,
          engine: 'homegrown',
          depth: rung.depth,
          blunderRate: rung.blunder_rate,
          thinkingMs: Date.now() - startedAt,
        });
        return {
          from: move.from,
          to: move.to,
          ...(move.promotion ? { promotion: move.promotion } : {}),
          san: move.san,
          engine: 'homegrown',
          thinkingMs: Date.now() - startedAt,
        };
      }

      const options = engineOptionsForRung(rung, logger);
      const startedAt = Date.now();
      // Serialized: one board in the house, so a queue beats a pool and keeps
      // latency predictable.
      const run = queue.then(() => search({ fen, gameId, options }));
      queue = run.catch(() => {});
      const uci = await run;
      const move = uci ? fromUci(fen, uci) : null;
      if (move) {
        const thinkingMs = Date.now() - startedAt;
        logger?.info?.('chess.engine.move', {
          rung: rung?.id,
          skill: options.skill ?? null,
          elo: options.elo ?? null,
          movetimeMs: options.movetimeMs,
          thinkingMs,
          engine: 'stockfish',
        });
        return { ...move, engine: 'stockfish', thinkingMs };
      }
      logger?.warn?.('chess.engine.fallback', {
        rung: rung?.id,
        skill: options.skill ?? null,
        elo: options.elo ?? null,
        movetimeMs: options.movetimeMs,
        reason: workerUsable ? 'no_bestmove' : 'worker_unavailable',
      });
      const fallback = homegrownChooseMove(fen, {
        difficulty: fallbackDifficultyFor(rung, options),
        seed: fen.length,
      });
      if (!fallback) return null;
      return {
        from: fallback.from,
        to: fallback.to,
        ...(fallback.promotion ? { promotion: fallback.promotion } : {}),
        san: fallback.san,
        engine: 'fallback',
        thinkingMs: Date.now() - startedAt,
      };
    },
    dispose() {
      worker?.terminate?.();
      worker = null;
      waiting.clear();
    },
  };
}

export default { createStockfishEngine, engineOptionsForRung, isHomegrownRung };
