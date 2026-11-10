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
 * no reading clears the baseline, so a reconnect is never held. A reading the
 * range check REJECTED is not "no reading": it leaves the baseline alone, so a
 * corrupt 240 cannot clear the way for a corrupt 204 behind it.
 *
 * Only a NEW beat can confirm. Garage has two ANT+ dongles and both hear every
 * broadcast, so the same over-the-air packet reaches this gate twice before the
 * multi-dongle dedup. Without the BeatCount check the second copy of a 204
 * "confirmed" the first (seen in review, 2026-10-23). A copy of the held packet
 * is dropped as 'duplicate'.
 *
 * A jump after a short SILENT gap (no packets, so the baseline was not
 * cleared, but older than the window) is accepted only PROVISIONALLY, judged
 * against the last reading within SPIKE_MEMORY_MS. If the next packet goes
 * back to that old line, the gap reading was the spike: the next packet is
 * accepted ('rejected') instead of being held. Without this a 204 after a
 * 2-5 s gap became the baseline, every real reading after it was held and
 * dropped, and the browser received a clean 204 stream (2026-10-24 review).
 *
 * Same rule as the browser's createHrSlewGate (browser/hooks/fitness/
 * hrPlausibility.js) — this package cannot import it, so the limits are
 * mirrored here and a test pins them.
 *
 * Pure and deterministic — `now` is injected.
 */

export const SPIKE_MAX_DELTA_BPM = 25;
export const SPIKE_WINDOW_MS = 2000;
/** How long the last accepted reading still judges a post-gap jump. */
export const SPIKE_MEMORY_MS = 30 * 1000;

export function createHrSpikeGate({
  maxDeltaBpm = SPIKE_MAX_DELTA_BPM, windowMs = SPIKE_WINDOW_MS, memoryMs = SPIKE_MEMORY_MS
} = {}) {
  // deviceId -> { last: {hr, ts, beatCount, priorHr?}|null, pending: {hr, ts}|null }
  // `last.priorHr` marks a provisional accept: a post-gap jump away from priorHr.
  const state = new Map();
  const close = (a, b) => Math.abs(a - b) < maxDeltaBpm;
  const sameBeat = (a, b) => Number.isFinite(a) && Number.isFinite(b) && a === b;

  return {
    /**
     * @param {string} deviceId
     * @param {{heartRate: number|null, now: number, beatCount?: number|null, rangeRejected?: boolean}} sample
     * @returns {{verdict: 'accept'|'held'|'confirmed'|'rejected'|'duplicate'|'none', hr: number|null,
     *   heldHr: number|null, previousHr: number|null, previousAgeMs: number|null}}
     */
    gate(deviceId, { heartRate, now, beatCount = null, rangeRejected = false }) {
      if (!Number.isFinite(heartRate) || heartRate <= 0) {
        if (!rangeRejected) state.delete(deviceId);
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
      const accept = (verdict, extra = {}) => {
        s.last = { hr: heartRate, ts: now, beatCount, ...(Number.isFinite(extra.priorHr) ? { priorHr: extra.priorHr } : {}) };
        s.pending = null;
        return { verdict, hr: heartRate, ...base, ...extra };
      };
      if (pending) {
        if (sameBeat(beatCount, pending.beatCount)) {
          return { verdict: 'duplicate', hr: null, ...base };
        }
        if (close(heartRate, pending.hr)) return accept('confirmed');
        if (last && close(heartRate, last.hr)) return accept('rejected');
        s.pending = { hr: heartRate, ts: now, beatCount };
        return { verdict: 'held', hr: null, ...base, heldHr: heartRate, replacedHr: pending.hr };
      }
      s.pending = null;
      // The provisional post-gap reading was the spike: back to the old line.
      if (last && Number.isFinite(last.priorHr) && !close(heartRate, last.hr) && close(heartRate, last.priorHr)) {
        return accept('rejected', { heldHr: last.hr, rejectedProvisional: true });
      }
      if (last && !close(heartRate, last.hr)) {
        s.pending = { hr: heartRate, ts: now, beatCount };
        return { verdict: 'held', hr: null, ...base, heldHr: heartRate };
      }
      const remembered = !last && s.last && now - s.last.ts <= memoryMs ? s.last : null;
      if (remembered && !close(heartRate, remembered.hr)) {
        // A remembered reading still carrying priorHr was never confirmed.
        const priorHr = Number.isFinite(remembered.priorHr) ? remembered.priorHr : remembered.hr;
        return accept('accept', { provisional: true, priorHr });
      }
      return accept('accept');
    }
  };
}

export default createHrSpikeGate;
