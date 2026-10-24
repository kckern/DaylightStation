/**
 * Heart-rate plausibility — single source of truth for filtering physiologically
 * impossible HR readings out of recorded fitness series.
 *
 * Background: the garage ANT+ bridge pairs to ANY device broadcasting an HR page
 * (wildcard scan), so dying straps and bike sensors can leak a junk reading
 * (e.g. 10/11 BPM from a strap in a drawer) into a session. The bridge now gates
 * 50–230 BPM at ingestion (_extensions/fitness/src/ant.mjs), but the recorders
 * apply their own floor as defense-in-depth for the simulation/BLE paths and in
 * case the bridge regresses.
 *
 * MIN matches the bridge's ANT+ floor (50). MAX is kept lenient (250) on the
 * recording side so a genuine max-effort spike from a child (max HR can exceed
 * 210) is never silently clipped from the saved chart; the bridge's stricter
 * 230 ceiling is the live guard.
 */

export const MIN_PLAUSIBLE_HR = 50;
export const MAX_PLAUSIBLE_HR = 250;

/**
 * Coerce a raw HR value to a clean integer, or null if missing/implausible.
 * @param {*} value
 * @returns {number|null}
 */
export function sanitizeHeartRate(value) {
  if (value == null) return null;
  const hr = Number(value);
  if (!Number.isFinite(hr)) return null;
  if (hr < MIN_PLAUSIBLE_HR || hr > MAX_PLAUSIBLE_HR) return null;
  return Math.round(hr);
}

/**
 * Slew gate — a heart rate cannot jump HR_SLEW_MAX_DELTA_BPM within
 * HR_SLEW_WINDOW_MS. A real effort climbs about 1-3 bpm/s.
 *
 * 2026-10-23: two straps each sent ONE 204 bpm packet in the middle of a
 * steady reading (152,152,204,153 and 111,204,110), and both became Fire
 * ceremonies with Fire-rate rings. A jump like that is held as `suspect`: it
 * reaches nothing until the next sample decides it.
 *   - next sample agrees with the held one -> `confirmed` (a real jump)
 *   - next sample agrees with the last accepted one -> `rejected` (a lone spike)
 *   - neither -> the new sample is held in its place
 * A reading older than the window is not compared against, so a return from a
 * break or a reconnect is never held for being different from before it.
 *
 * But a jump after a short SILENT gap (no packets, so no reset; baseline still
 * within HR_SLEW_MEMORY_MS) is accepted only PROVISIONALLY. If the very next
 * sample disagrees with it and agrees with the pre-gap baseline, the gap
 * reading was the spike: the next sample is accepted ('rejected', the spike
 * discarded) instead of being held as the odd one out. Without this a 204
 * after a 2-5s gap became the baseline, and a 204/real alternation then kept
 * accepting the 204s and holding the real readings (2026-10-24 audit) — a
 * Fire stint built entirely from corrupt packets.
 *
 * The garage bridge runs the same rule (satellites/fitness-controller/src/
 * hrSpikeGate.mjs) so the bad value is stopped at the source too; this copy is
 * the browser's own guard for BLE, simulation and a bridge that regresses.
 */
export const HR_SLEW_MAX_DELTA_BPM = 25;
export const HR_SLEW_WINDOW_MS = 2000;
/** How long the last accepted reading still judges a post-gap jump (provisional accept). */
export const HR_SLEW_MEMORY_MS = 30 * 1000;

/**
 * @returns {{
 *   evaluate(deviceId: string, hr: number, ts: number): {
 *     verdict: 'accept'|'suspect'|'confirmed'|'rejected', hr: number|null,
 *     previousHr: number|null, previousAgeMs: number|null,
 *     heldHr: number|null, heldAgeMs: number|null
 *   },
 *   reset(deviceId?: string): void
 * }}
 */
export function createHrSlewGate({
  maxDeltaBpm = HR_SLEW_MAX_DELTA_BPM, windowMs = HR_SLEW_WINDOW_MS, memoryMs = HR_SLEW_MEMORY_MS
} = {}) {
  // deviceId -> { last: {hr, ts, priorHr?}|null, pending: {hr, ts}|null }
  // `last.priorHr` marks a provisional accept: a post-gap jump away from priorHr.
  const state = new Map();
  const close = (a, b) => Math.abs(a - b) < maxDeltaBpm;

  return {
    evaluate(deviceId, hr, ts) {
      const key = String(deviceId);
      let s = state.get(key);
      if (!s) { s = { last: null, pending: null }; state.set(key, s); }
      const last = s.last && ts - s.last.ts <= windowMs ? s.last : null;
      const pending = s.pending && ts - s.pending.ts <= windowMs ? s.pending : null;
      const base = {
        previousHr: s.last?.hr ?? null,
        previousAgeMs: s.last ? ts - s.last.ts : null,
        heldHr: pending?.hr ?? null,
        heldAgeMs: pending ? ts - pending.ts : null
      };
      const accept = (verdict, extra = {}) => {
        s.last = { hr, ts, ...(Number.isFinite(extra.priorHr) ? { priorHr: extra.priorHr } : {}) };
        s.pending = null;
        return { verdict, hr, ...base, ...extra };
      };
      if (pending) {
        if (close(hr, pending.hr)) return accept('confirmed');
        if (last && close(hr, last.hr)) return accept('rejected');
        s.pending = { hr, ts };
        return { verdict: 'suspect', hr: null, ...base, heldHr: hr, heldAgeMs: 0, replacedHr: pending.hr };
      }
      s.pending = null;
      // The provisional post-gap reading was the spike: back to the old line.
      if (last && Number.isFinite(last.priorHr) && !close(hr, last.hr) && close(hr, last.priorHr)) {
        return accept('rejected', { heldHr: last.hr, rejectedProvisional: true });
      }
      if (last && !close(hr, last.hr)) {
        s.pending = { hr, ts };
        return { verdict: 'suspect', hr: null, ...base, heldHr: hr, heldAgeMs: 0 };
      }
      const remembered = !last && s.last && ts - s.last.ts <= memoryMs ? s.last : null;
      if (remembered && !close(hr, remembered.hr)) {
        return accept('accept', { provisional: true, priorHr: remembered.hr });
      }
      return accept('accept');
    },
    reset(deviceId) {
      if (deviceId == null) state.clear();
      else state.delete(String(deviceId));
    }
  };
}
