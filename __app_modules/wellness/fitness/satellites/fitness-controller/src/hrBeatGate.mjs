/**
 * Heart-rate beat-gate.
 *
 * ANT+ HR straps, on waking from sleep, re-broadcast the last ComputedHeartRate
 * they held before sleeping (e.g. 161 bpm three hours later), then send 0 for
 * ~16s (once 422s), and only then start counting real beats. The 50–230 range
 * check lets the replayed value straight through, so a resting rider shows up
 * at their last workout's peak.
 *
 * The strap's BeatCount (8-bit, wraps at 256) is ground truth: it advances only
 * when the strap actually detects a heartbeat. Every replayed or held value sits
 * on a frozen count. So:
 *
 *  - After a device is first seen, or returns after more than WAKE_SILENCE_MS of
 *    silence, HR is withheld (null) until the count has advanced
 *    WAKE_ADVANCES_REQUIRED times — two genuinely new beats.
 *  - While open, if the count has not advanced for more than BEAT_FROZEN_MS the
 *    strap has lost contact or frozen, and HR is withheld until it advances again.
 *
 * Any change in BeatCount counts as an advance, so 255 -> 0 is handled the same
 * way the cadence gate handles a 16-bit revolution wrap. BeatEventTime (1/1024 s,
 * wraps at 65536) is tracked for diagnostics only; the count is the signal.
 *
 * Pure and deterministic — `now` is injected so it is fully unit-testable.
 */

/** Silence longer than this means the strap slept; it must prove itself again. */
export const WAKE_SILENCE_MS = 5000;
/** No new beat for longer than this while packets keep arriving = contact lost / frozen. */
export const BEAT_FROZEN_MS = 3000;
/** New beats that must be seen after a wake before HR is trusted. */
export const WAKE_ADVANCES_REQUIRED = 2;

const BEAT_COUNT_MOD = 256;
const BEAT_TIME_MOD = 65536;

export function createHrBeatGate({
  wakeSilenceMs = WAKE_SILENCE_MS,
  beatFrozenMs = BEAT_FROZEN_MS,
  wakeAdvancesRequired = WAKE_ADVANCES_REQUIRED
} = {}) {
  // deviceId -> { lastSeen, wakeTs, open, advances, lastBeatCount, lastBeatTime, lastBeatChangeTs }
  const state = new Map();

  return {
    /**
     * @param {string} deviceId
     * @param {{heartRate: number|null, beatCount: number|null|undefined, beatTime: number|null|undefined, now: number}} sample
     * @returns {{hr: number|null, openedAfterMs?: number}} hr to use (null = withheld);
     *   `openedAfterMs` is set only on the packet that opens the gate after a wake.
     */
    gate(deviceId, { heartRate, beatCount, beatTime, now }) {
      const hr = Number.isFinite(heartRate) ? heartRate : null;

      // No beat data → can't gate; trust the raw value (range check still applies downstream).
      if (!Number.isFinite(beatCount)) return { hr };

      const count = ((beatCount % BEAT_COUNT_MOD) + BEAT_COUNT_MOD) % BEAT_COUNT_MOD;
      const time = Number.isFinite(beatTime) ? beatTime % BEAT_TIME_MOD : null;

      let s = state.get(deviceId);
      if (!s || now - s.lastSeen > wakeSilenceMs) {
        // First sight or wake: whatever the strap is saying now may be a replay.
        s = {
          lastSeen: now,
          wakeTs: now,
          open: false,
          advances: 0,
          lastBeatCount: count,
          lastBeatTime: time,
          lastBeatChangeTs: now
        };
        state.set(deviceId, s);
        return { hr: null };
      }
      s.lastSeen = now;

      if (count !== s.lastBeatCount) {
        s.lastBeatCount = count;
        s.lastBeatTime = time;
        s.lastBeatChangeTs = now;
        if (!s.open) s.advances += 1;
      }

      if (!s.open) {
        if (s.advances < wakeAdvancesRequired) return { hr: null };
        s.open = true;
        return { hr, openedAfterMs: now - s.wakeTs };
      }

      if (now - s.lastBeatChangeTs > beatFrozenMs) return { hr: null };
      return { hr };
    }
  };
}

export default createHrBeatGate;
