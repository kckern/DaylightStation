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

// Per-arm scan timeout. MUST exceed the garage reader's capture window
// (`fingerprint_helper.py identify --timeout 15` = 15s) plus the WS round-trip,
// or a real finger-press that lands late in that window returns *after* the
// broker has already timed out and discarded the requestId — silently dropping
// the match (the bug that made a pressed emergency finger do nothing). 18s gives
// ~3s of slack over the 15s capture while staying under the garage helper's 20s
// hard SIGTERM bound, so the reader still frees promptly for foreground unlocks.
const DEFAULT_ARM_TIMEOUT_MS = 18000;
const PENDING_TTL_MS = 30000;

/**
 * @param {object} deps
 * @param {{ requestUnlock: Function, isForegroundActive?: Function }} deps.unlockService
 * @param {{ broadcast: Function }} deps.eventBus
 * @param {() => object} deps.loadFitnessConfig - returns raw fitness config (default household)
 * @param {{ getProfile: Function }} deps.userService
 * @param {() => Promise<boolean>} deps.isLocked - true while a lockdown is committed
 * @param {() => number} [deps.clock] - injectable monotonic-ish clock (ms)
 * @param {number} [deps.armTimeoutMs] - per-arm scan timeout; must be >= the
 *   garage capture window (15s) + round-trip or late presses are dropped
 * @param {number} [deps.idleDelayMs] - pause between checks while yielded/locked
 * @param {number} [deps.settleDelayMs] - pause after a detection to avoid re-capture
 * @param {number} [deps.pendingTtlMs] - how long a pending detection stays valid
 * @param {number} [deps.interArmIdleMs] - hardware hedge: pause between re-arms so
 *   the reader isn't armed 100% of the time (0 = continuous, the default)
 * @param {{start:number,end:number}|null} [deps.activeHours] - hardware hedge: only
 *   arm when the local hour is within [start, end) (supports overnight wrap, e.g.
 *   {start:22,end:6}); null = always armed (the default)
 * @param {() => number} [deps.getHour] - injectable local-hour provider for activeHours
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
  interArmIdleMs = 0,
  activeHours = null,
  getHour = () => new Date().getHours(),
  setTimeoutFn = setTimeout,
  logger = console,
} = {}) {
  let running = false;
  let pending = null; // { userId, at }
  let loopPromise = null;
  // Track the current "why aren't we arming" state so we log transitions once
  // (entering/leaving a stand-down reason) instead of spamming every loop tick.
  let standReason = 'starting';

  function delay(ms) {
    return new Promise((r) => setTimeoutFn(r, ms));
  }

  // Log a stand-down / resume transition exactly once when the reason changes.
  // reason === 'arming' means actively armed; anything else is a stand-down.
  function noteState(reason, extra = {}) {
    if (reason === standReason) return;
    standReason = reason;
    if (reason === 'arming') logger.info?.('emergency.arming_resumed', extra);
    else logger.info?.('emergency.standing_down', { reason, ...extra });
  }

  // Hardware hedge: only arm during configured hours. Supports an overnight
  // window (start > end), e.g. {start:22,end:6} → armed 10pm–6am.
  function withinActiveHours() {
    if (!activeHours) return true;
    const { start = 0, end = 24 } = activeHours;
    if (start === end) return true; // degenerate / always
    const h = getHour();
    return start < end ? h >= start && h < end : h >= start || h < end;
  }

  async function loop() {
    while (running) {
      try {
        // Stand down while a foreground unlock owns the reader, while a lockdown
        // is already committed, or outside the configured active-hours window.
        // Each reason is logged once on transition (noteState) so logs show WHY
        // the detector isn't arming without spamming every tick.
        if (unlockService.isForegroundActive?.()) {
          noteState('foreground-unlock');
          await delay(idleDelayMs);
          continue;
        }
        if (await isLocked()) {
          noteState('lockdown-active');
          await delay(idleDelayMs);
          continue;
        }
        if (!withinActiveHours()) {
          noteState('outside-active-hours', { activeHours });
          await delay(idleDelayMs);
          continue;
        }

        const fitnessConfig = loadFitnessConfig() || {};
        const candidates = resolveEmergencyCandidates({ fitnessConfig, userService });
        if (candidates.length === 0) {
          // No admins configured; back off a bit longer before re-checking.
          noteState('no-candidates');
          await delay(idleDelayMs * 4);
          continue;
        }

        noteState('arming', { candidates: candidates.length });
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
        } else if (interArmIdleMs > 0) {
          // Hardware hedge: rest between re-arms so the reader isn't armed 100%
          // of the time (also widens the gap a normal unlock can claim it in).
          await delay(interArmIdleMs);
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
        logger.info?.('emergency.pending_consumed', { userId: p.userId, ageMs: now - p.at });
        return p;
      }
      if (pending) {
        logger.warn?.('emergency.pending_expired', { userId: pending.userId, ageMs: now - pending.at, ttlMs: pendingTtlMs });
      } else {
        logger.debug?.('emergency.pending_absent', {});
      }
      pending = null;
      return null;
    },
  };
}
