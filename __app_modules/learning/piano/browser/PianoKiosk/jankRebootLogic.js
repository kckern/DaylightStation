// jankRebootLogic.js
//
// Pure decision helpers for the user-facing reboot prompt. When the WebView is
// alive but rendering is durably degraded (the SM-T590 GPU/renderer latch — see
// reference_piano_tablet_jank_current_state), we no longer silently reload /
// restart / reboot. Instead the page asks the user: reboot now, or not now
// (snooze for a while, then re-arm). These helpers hold the "should we ask?"
// logic so it is testable without a DOM, rAF, or localStorage.

export const SNOOZE_KEY = 'piano.jankReboot.snoozeUntil';

/** True while a prior "Not now" snooze is still in effect. */
export function isSnoozed(snoozeUntilMs, nowMs) {
  return typeof snoozeUntilMs === 'number' && Number.isFinite(snoozeUntilMs) && snoozeUntilMs > nowMs;
}

/**
 * Decide whether the reboot prompt should be open this tick.
 * @param {object} p
 * @param {number} p.sustainedLowSec  consecutive seconds of visible sub-minFps rendering
 * @param {number} p.sustainSec       how long it must persist before we ask
 * @param {number|null} p.snoozeUntilMs  epoch ms the user snoozed until (null = not snoozed)
 * @param {number} p.nowMs
 * @param {boolean} p.alreadyOpen     once open it stays open until the user acts
 * @returns {boolean}
 */
export function shouldPrompt({ sustainedLowSec, sustainSec, snoozeUntilMs, nowMs, alreadyOpen }) {
  if (alreadyOpen) return true;
  if (isSnoozed(snoozeUntilMs, nowMs)) return false;
  return sustainedLowSec >= sustainSec;
}

export const RECOVERY_KEY = 'piano.jankReboot.request';
export const RECOVERY_MAX_AGE_MS = 10 * 60 * 1000;

/** A bounded, usable request correlation; expiry is failed proof, not proof of reboot failure. */
export function recoveryRequestValid(request, nowMs) {
  return Boolean(request && Number.isFinite(nowMs) && Number.isFinite(request.requestedAtMs)
    && nowMs >= request.requestedAtMs && nowMs - request.requestedAtMs <= RECOVERY_MAX_AGE_MS
    && typeof request.deviceId === 'string' && request.deviceId.length > 0
    && request.bootIdentitySource === 'settings.global.boot_count'
    && Number.isInteger(request.bootCount) && request.bootCount >= 0);
}

/** Same device, actual OS boot counter, and a currently healthy native-ingested beat.
 * A process restart, accepted command, old outcome, or missing readback proves nothing. */
export function recoveryVerified(request, evidence, nowMs) {
  return Boolean(recoveryRequestValid(request, nowMs) && evidence
    && evidence.deviceId === request.deviceId
    && request.bootIdentitySource === 'settings.global.boot_count'
    && evidence.bootIdentitySource === request.bootIdentitySource
    && Number.isInteger(request.bootCount) && request.bootCount >= 0
    && Number.isInteger(evidence.bootCount) && evidence.bootCount > request.bootCount
    && typeof evidence.payload === 'string' && evidence.payload.length > 0
    && Number.isFinite(evidence.lastBeatAgoMs) && evidence.lastBeatAgoMs >= 0 && evidence.lastBeatAgoMs <= 5000
    && Number.isInteger(evidence.beatCount) && evidence.beatCount > 0 && evidence.lastVisibility === 'visible'
    && evidence.liveness === 'alive' && evidence.responsiveness === 'healthy'
    && evidence.nativeRecoveryAllowed === true);
}
