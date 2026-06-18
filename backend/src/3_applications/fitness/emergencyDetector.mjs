// backend/src/3_applications/fitness/emergencyDetector.mjs

/**
 * Backend emergency-detector loop.
 *
 * A long-running service that keeps an `emergency` fingerprint scan armed
 * against the garage reader. On an admin fingerprint match it broadcasts
 * `fitness.emergency.detected` over the websocket eventbus and records a
 * short-lived "pending detection" so a later HTTP `commit` (issued after the
 * browser's audio ceremony) can confirm a real detection occurred.
 *
 * Reader contention: the single garage reader is shared with normal
 * (foreground) unlocks. The detector stands down while a foreground unlock is
 * in flight (`unlockService.isForegroundActive()`) and while a lockdown is
 * already committed (`isLocked()`), so it never steals the reader from a normal
 * unlock and never re-arms during an active lockdown.
 *
 * @module 3_applications/fitness/emergencyDetector
 */

import { resolveEmergencyCandidates } from './emergencyPolicy.mjs';

const DEFAULT_ARM_TIMEOUT_MS = 8000;
const PENDING_TTL_MS = 30000;

/**
 * @param {object} deps
 * @param {{ requestUnlock: Function, isForegroundActive?: Function }} deps.unlockService
 * @param {{ broadcast: Function }} deps.eventBus
 * @param {() => object} deps.loadFitnessConfig - returns raw fitness config (default household)
 * @param {{ getProfile: Function }} deps.userService
 * @param {() => Promise<boolean>} deps.isLocked - true while a lockdown is committed
 * @param {() => number} [deps.clock] - injectable monotonic-ish clock (ms)
 * @param {number} [deps.armTimeoutMs] - per-arm scan timeout
 * @param {number} [deps.idleDelayMs] - pause between checks while yielded/locked
 * @param {number} [deps.settleDelayMs] - pause after a detection to avoid re-capture
 * @param {number} [deps.pendingTtlMs] - how long a pending detection stays valid
 * @param {Function} [deps.setTimeoutFn] - injectable setTimeout for tests
 * @param {object} [deps.logger] - structured logger (console-compatible)
 */
export function createEmergencyDetector({
  unlockService,
  eventBus,
  loadFitnessConfig,
  userService,
  isLocked,
  clock = () => Date.now(),
  armTimeoutMs = DEFAULT_ARM_TIMEOUT_MS,
  idleDelayMs = 500,
  settleDelayMs = 1500,
  pendingTtlMs = PENDING_TTL_MS,
  setTimeoutFn = setTimeout,
  logger = console,
} = {}) {
  let running = false;
  let pending = null; // { userId, at }
  let loopPromise = null;

  function delay(ms) {
    return new Promise((r) => setTimeoutFn(r, ms));
  }

  async function loop() {
    while (running) {
      try {
        // Stand down while a foreground unlock owns the reader, or while a
        // lockdown is already committed.
        if (unlockService.isForegroundActive?.() || (await isLocked())) {
          await delay(idleDelayMs);
          continue;
        }

        const fitnessConfig = loadFitnessConfig() || {};
        const candidates = resolveEmergencyCandidates({ fitnessConfig, userService });
        if (candidates.length === 0) {
          // No admins configured; back off a bit longer before re-checking.
          await delay(idleDelayMs * 4);
          continue;
        }

        logger.debug?.('emergency.armed', { candidates: candidates.length });
        const result = await unlockService.requestUnlock('emergency', candidates, {
          timeoutMs: armTimeoutMs,
        });
        if (!running) break;

        if (result?.matched) {
          // pending.at stays in ms for the TTL math below; the broadcast `at` is
          // emitted in epoch SECONDS to match the rest of the emergency channel
          // (locked/released payloads + LockdownState are all seconds).
          pending = { userId: result.userId, at: clock() };
          logger.info?.('emergency.detected', { userId: result.userId });
          eventBus.broadcast('fitness.emergency.detected', {
            userId: result.userId,
            at: Math.floor(pending.at / 1000),
          });
          // Pause so the same finger-press isn't re-captured immediately.
          await delay(settleDelayMs);
        }
      } catch (err) {
        logger.warn?.('emergency.detector_error', { error: err?.message });
        await delay(idleDelayMs * 2);
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
      logger.info?.('emergency.detector_started');
    },

    async stop() {
      running = false;
      try {
        await loopPromise;
      } catch {
        /* ignore — the loop swallows its own errors, this is belt-and-suspenders */
      }
      loopPromise = null;
      logger.info?.('emergency.detector_stopped');
    },

    /**
     * Atomically take the pending detection if one exists and is within TTL.
     * Always clears `pending` (consume-once); returns null when none/expired.
     * @param {number} [now]
     * @returns {{ userId: string, at: number } | null}
     */
    consumePendingDetection(now = clock()) {
      if (pending && now - pending.at <= pendingTtlMs) {
        const p = pending;
        pending = null;
        return p;
      }
      pending = null;
      return null;
    },
  };
}
