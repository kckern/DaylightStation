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
