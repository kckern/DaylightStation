/**
 * Heart-rate spike gate (slew limit).
 *
 * A heart rate cannot jump SPIKE_MAX_DELTA_BPM within SPIKE_WINDOW_MS — a real
 * effort climbs 1-3 bpm/s. On 2026-10-23 straps strap-a1 and strap-b1 each broadcast
 * ONE ComputedHeartRate=204 packet in the middle of a steady reading
 * (152,152,204,153 and 111,204,110). BeatCount advanced normally, so the beat
 * gate passed it, and 204 is inside the 50-230 range check. The app turned
 * both into Fire ceremonies.
 *
 * A jump is HELD (hr null — the packet is not broadcast as a reading) until the
 * next packet decides it:
 *   - agrees with the held value      -> 'confirmed' (a real jump)
 *   - agrees with the last accepted   -> 'rejected'  (a lone spike)
 *   - neither                          -> the new value is held in its place
 * A reading older than the window is not compared against, and a packet with
 * no reading clears the baseline, so a reconnect is never held.
 *
 * Same rule as the browser's createHrSlewGate (browser/hooks/fitness/
 * hrPlausibility.js) — this package cannot import it, so the limits are
 * mirrored here and a test pins them.
 *
 * Pure and deterministic — `now` is injected.
 */

export const SPIKE_MAX_DELTA_BPM = 25;
export const SPIKE_WINDOW_MS = 2000;

export function createHrSpikeGate({ maxDeltaBpm = SPIKE_MAX_DELTA_BPM, windowMs = SPIKE_WINDOW_MS } = {}) {
  // deviceId -> { last: {hr, ts}|null, pending: {hr, ts}|null }
  const state = new Map();
  const close = (a, b) => Math.abs(a - b) < maxDeltaBpm;

  return {
    /**
     * @param {string} deviceId
     * @param {{heartRate: number|null, now: number}} sample
     * @returns {{verdict: 'accept'|'held'|'confirmed'|'rejected'|'none', hr: number|null,
     *   heldHr: number|null, previousHr: number|null, previousAgeMs: number|null}}
     */
    gate(deviceId, { heartRate, now }) {
      if (!Number.isFinite(heartRate) || heartRate <= 0) {
        state.delete(deviceId);
        return { verdict: 'none', hr: Number.isFinite(heartRate) ? heartRate : null, heldHr: null, previousHr: null, previousAgeMs: null };
      }
      let s = state.get(deviceId);
      if (!s) { s = { last: null, pending: null }; state.set(deviceId, s); }
      const last = s.last && now - s.last.ts <= windowMs ? s.last : null;
      const pending = s.pending && now - s.pending.ts <= windowMs ? s.pending : null;
      const base = {
        heldHr: pending?.hr ?? null,
        previousHr: s.last?.hr ?? null,
        previousAgeMs: s.last ? now - s.last.ts : null
      };
      const accept = (verdict) => {
        s.last = { hr: heartRate, ts: now };
        s.pending = null;
        return { verdict, hr: heartRate, ...base };
      };
      if (pending) {
        if (close(heartRate, pending.hr)) return accept('confirmed');
        if (last && close(heartRate, last.hr)) return accept('rejected');
        s.pending = { hr: heartRate, ts: now };
        return { verdict: 'held', hr: null, ...base, heldHr: heartRate, replacedHr: pending.hr };
      }
      s.pending = null;
      if (last && !close(heartRate, last.hr)) {
        s.pending = { hr: heartRate, ts: now };
        return { verdict: 'held', hr: null, ...base, heldHr: heartRate };
      }
      return accept('accept');
    }
  };
}

export default createHrSpikeGate;
