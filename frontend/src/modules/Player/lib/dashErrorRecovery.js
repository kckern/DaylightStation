/**
 * dash.js error recovery: classification + ledger-gated request.
 *
 * In the 2026-05-23 fitness session (`fs_20260523132554`), a Plex
 * transcode session that had been alive 10 minutes pre-workout got
 * reaped by Plex's idle timer. dash.js fired error 27 (segment
 * unavailable) then 28 (init segment / header unavailable) repeatedly.
 * The existing `hardReset({ refreshUrl: true })` mechanism — which
 * mutates the <dash-video> `src` so the backend mints a fresh Plex
 * transcode session — exists and is tested, but the dash error handler
 * did not call it. User had to manually close + restart the player.
 *
 * `decideDashErrorRecovery` classifies: `{ action: 'refresh-url' }` for
 * the two error codes that signal "the source URL is dead, please
 * re-fetch"; `{ action: 'ignore' }` for everything else (mid-stream
 * decode/network errors owned by the nudge/jolt pipeline).
 *
 * Attempt accounting lives in the shared recoveryLedger (audit §3.1):
 * the 'dash-error' actor has a per-mount budget of 3 (a remount mints a
 * fresh Plex session, so the cap must not leak across mounts) and every
 * fired refresh counts toward the session-wide recovery cap the
 * resilience/jolt actors share. `bypassCooldown: true` preserves the
 * pre-ledger UX (dash errors fire immediately) while still recording —
 * so dash-error activity pushes the shared cooldown window forward.
 *
 * Bug ref: docs/_wip/bugs/2026-05-23-fitness-stall-watchdog-noise-and-play-fails-during-real-stall.md §2
 */

import { getRecoveryLedger } from './recoveryLedger.js';

const SEGMENT_UNAVAILABLE = 27;          // dash.js MEDIA_ERR_DECODE or fragment 404
const INIT_OR_MANIFEST_UNAVAILABLE = 28; // dash.js manifest loader / init segment loader

const REASON_BY_CODE = {
  [SEGMENT_UNAVAILABLE]: 'segment-unavailable',
  [INIT_OR_MANIFEST_UNAVAILABLE]: 'init-or-manifest-unavailable'
};

/** Pure classification: is this dash error code a dead-source-URL signal? */
export function decideDashErrorRecovery({ errorCode }) {
  // Strict comparison: dash.js emits numeric codes; a string '27' is not one.
  if (errorCode !== SEGMENT_UNAVAILABLE && errorCode !== INIT_OR_MANIFEST_UNAVAILABLE) {
    return { action: 'ignore', reason: 'not-a-source-url-error' };
  }
  return { action: 'refresh-url', reason: REASON_BY_CODE[errorCode] };
}

/**
 * Classify the error and, for refreshable codes, ask the shared ledger for
 * permission (recording the attempt when granted). Non-refreshable codes
 * never touch the ledger.
 *
 * @param {Object} params
 * @param {number} params.errorCode - dash.js error code
 * @param {string|null} params.sessionKey - playback session key (Player's itemSessionKey)
 * @param {*} params.mountId - per-mount identity (fresh budget per VideoPlayer mount)
 * @param {Object} [params.ledger] - injectable for tests; defaults to the shared singleton
 * @returns {{ fire: boolean, decision: {action:string, reason:string}, gate: Object|null }}
 *   `fire` = true → caller should hardReset({ refreshUrl: true }).
 *   `gate` is the ledger response (null when the code was not refreshable).
 */
export function requestDashErrorRecovery({ errorCode, sessionKey, mountId, ledger = getRecoveryLedger() }) {
  const decision = decideDashErrorRecovery({ errorCode });
  if (decision.action !== 'refresh-url') {
    return { fire: false, decision, gate: null };
  }
  const gate = ledger.request({
    // A falsy sessionKey would hit the ledger's allow-always passthrough,
    // making hardResets uncapped for any future direct SinglePlayer embedder
    // that doesn't thread a playbackSessionKey. Fall back to a shared bucket
    // so unkeyed dash-error recoveries still respect the caps.
    sessionKey: sessionKey || 'player-item:unkeyed',
    mountId,
    actor: 'dash-error',
    reason: `dash-${errorCode}`,
    bypassCooldown: true,
    isUrlRefresh: true
  });
  return { fire: gate.allowed, decision, gate };
}
