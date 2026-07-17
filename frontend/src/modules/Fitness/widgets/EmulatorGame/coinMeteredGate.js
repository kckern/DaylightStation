/**
 * coinMeteredGate — a coin-metered governance gate for the Emulator Console.
 *
 * The arcade drains a player's household coins while they play. This gate is the
 * CLIENT half of the metered-spend contract: it opens a spend session against
 * the economy API, meters locally at a fixed drain rate, settles the cumulative
 * total periodically (hold-and-settle), and closes on exit or depletion.
 *
 * It satisfies the same surface the EmulatorConsole consumes —
 *   { isPlayable(), getStatus() -> { state }, onChange(cb) -> unsubscribe }
 * — matching the framework idioms in
 *   frontend/src/modules/Emulator/adapters/GovernanceGate.js
 * and adds an async lifecycle (start/settle/stop) on top.
 *
 * SETTLE CONTRACT: `coins` sent to settle/close is the CUMULATIVE total coins
 * consumed since the session opened (a monotonically increasing high-water mark),
 * NOT a per-interval delta. The server charges only newly-crossed whole coins, so
 * settles are idempotent and safe to retry. ALWAYS send the running total.
 */

import { DaylightAPI } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';

// Lazy module logger (avoids import-time timing issues; never raw console).
let _log;
const log = () => (_log ||= getLogger().child({ component: 'coin-metered-gate' }));

// When fewer than this many seconds of play remain, surface the 'warning' state.
// Still playable — just a low-balance heads-up. Based on drain rate via secondsLeft.
const WARNING_SECONDS_LEFT = 30;

/**
 * Default API adapter: a thin wrapper over DaylightAPI. Injectable so tests can
 * pass a fake and fully control balance / drainPerSecond / depletion. The metering
 * logic NEVER calls DaylightAPI directly — only through this adapter.
 */
export function createDefaultCoinApi() {
  return {
    openSession: ({ userId, action, source }) =>
      DaylightAPI(`api/v1/economy/users/${userId}/sessions`, { action, source }),
    settle: ({ userId, sessionId, coins }) =>
      DaylightAPI(`api/v1/economy/users/${userId}/sessions/${sessionId}/settle`, { coins }),
    close: ({ userId, sessionId, coins }) =>
      DaylightAPI(`api/v1/economy/users/${userId}/sessions/${sessionId}/close`, { coins }),
  };
}

/**
 * Create a coin-metered gate.
 *
 * @param {object} opts
 * @param {string} opts.userId               household user whose coins are spent
 * @param {string} [opts.action='arcade-play'] economy action label
 * @param {object} [opts.api]                 injectable api adapter (see createDefaultCoinApi)
 * @param {number} [opts.settleIntervalSec=60] seconds between periodic settles
 * @param {number} [opts.tickIntervalMs=1000] local meter tick cadence
 * @returns {{
 *   mode: 'coin-metered',
 *   start: () => Promise<object>,
 *   stop: () => Promise<void>,
 *   tick: () => void,
 *   isPlayable: () => boolean,
 *   getStatus: () => { state: string, coins: number, secondsLeft: number, reason: (string|null) },
 *   onChange: (cb: Function) => Function,
 * }}
 */
export function createCoinMeteredGate({
  userId,
  action = 'arcade-play',
  api,
  settleIntervalSec = 60,
  tickIntervalMs = 1000,
} = {}) {
  const coinApi = api || createDefaultCoinApi();
  const secondsPerTick = tickIntervalMs / 1000;

  // --- Internal state ---
  let state = 'idle'; // 'idle' | 'playing' | 'warning' | 'paused' | 'depleted'
  let balanceAtOpen = 0; // coins available when the session opened
  let totalConsumed = 0; // fractional running total of coins consumed
  let drainPerSecond = 0; // coins consumed per second of play
  let sessionId = null;
  let reason = null; // human-readable explanation for a depleted/blocked state

  let tickHandle = null; // setInterval handle
  let secondsSinceSettle = 0; // accumulator toward the next periodic settle
  let settling = false; // guard against overlapping settle() calls
  let sessionClosed = false; // close posted (or never opened) — stop() no-ops after
  let stopped = false; // stop() has run at least once

  const listeners = new Set();

  const remainingCoins = () => balanceAtOpen - totalConsumed;

  function computeStatus() {
    const remaining = remainingCoins();
    return {
      state,
      coins: Math.max(0, Math.floor(remaining)),
      secondsLeft: drainPerSecond > 0 ? Math.max(0, Math.floor(remaining / drainPerSecond)) : 0,
      reason,
    };
  }

  function notify() {
    const status = computeStatus();
    for (const cb of listeners) {
      try {
        cb(status);
      } catch (err) {
        log().warn('coin-gate.listener-error', { error: err && err.message });
      }
    }
  }

  // Transition state; notify only on an actual change.
  function setState(next) {
    if (next === state) return;
    state = next;
    notify();
  }

  function clearTick() {
    if (tickHandle != null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  // --- Periodic settle (hold-and-settle: send the CUMULATIVE running total) ---
  async function settle() {
    if (settling || stopped || !sessionId) return;
    settling = true;
    const coins = totalConsumed; // cumulative high-water mark, not a delta
    try {
      log().debug('coin-gate.settle', { userId, sessionId, coins });
      const res = await coinApi.settle({ userId, sessionId, coins });
      if (res && res.depleted) {
        reason = 'Out of coins';
        setState('depleted');
        await stop();
      }
      // Server balance is truth, but the local countdown stays driven by
      // totalConsumed for a smooth meter; no forced reconciliation needed.
    } catch (err) {
      // Settles are idempotent/retryable — a transient failure is non-fatal;
      // the next interval resends a larger cumulative total.
      log().warn('coin-gate.settle-failed', { userId, sessionId, error: err && err.message });
    } finally {
      settling = false;
    }
  }

  // --- Local meter tick ---
  function tick() {
    if (state !== 'playing' && state !== 'warning') return;

    totalConsumed += drainPerSecond * secondsPerTick;
    const remaining = remainingCoins();

    if (remaining <= 0) {
      totalConsumed = balanceAtOpen; // clamp so remaining is exactly 0
      reason = 'Out of coins';
      setState('depleted');
      log().info('coin-gate.depleted', { userId, sessionId, coins: totalConsumed });
      // stop() settles the tail + closes the session.
      stop();
      return;
    }

    // Low-balance heads-up (still playable).
    if (drainPerSecond > 0 && remaining / drainPerSecond < WARNING_SECONDS_LEFT) {
      setState('warning');
    } else {
      setState('playing');
    }

    // Periodic settle every settleIntervalSec worth of ticks.
    secondsSinceSettle += secondsPerTick;
    if (secondsSinceSettle >= settleIntervalSec) {
      secondsSinceSettle -= settleIntervalSec;
      settle();
    }
  }

  // --- Lifecycle ---
  async function start() {
    try {
      const res = await coinApi.openSession({ userId, action, source: 'emulator' });
      sessionId = res.sessionId;
      balanceAtOpen = Number(res.balance) || 0;
      drainPerSecond = Number(res.drainPerSecond) || 0;
      totalConsumed = 0;
      secondsSinceSettle = 0;
      reason = null;
      sessionClosed = false;
      stopped = false;
      setState('playing');
      log().info('coin-gate.open', { userId, sessionId, balance: balanceAtOpen, drainPerSecond });
      clearTick();
      tickHandle = setInterval(tick, tickIntervalMs);
      return computeStatus();
    } catch (err) {
      reason = (err && err.message) || 'Unable to start session';
      setState('depleted');
      log().warn('coin-gate.start-failed', { userId, action, error: reason });
      return computeStatus();
    }
  }

  // Idempotent: clear the meter, close the session once (final cumulative total).
  async function stop() {
    clearTick();
    if (stopped || sessionClosed) {
      stopped = true;
      return;
    }
    stopped = true;
    if (!sessionId) {
      sessionClosed = true;
      return;
    }
    const coins = totalConsumed; // final cumulative total
    sessionClosed = true;
    try {
      const res = await coinApi.close({ userId, sessionId, coins });
      log().info('coin-gate.close', { userId, sessionId, coins, balance: res && res.balance });
    } catch (err) {
      log().warn('coin-gate.close-failed', { userId, sessionId, coins, error: err && err.message });
    }
  }

  return {
    mode: 'coin-metered',
    start,
    stop,
    tick, // exposed for manual/test driving; safe to call (no-op unless playing)
    isPlayable: () => state === 'playing' || state === 'warning',
    getStatus: () => computeStatus(),
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export default { createCoinMeteredGate, createDefaultCoinApi };
