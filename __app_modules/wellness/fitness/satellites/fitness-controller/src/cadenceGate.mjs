/**
 * Cadence revolution-gate.
 *
 * ANT+ cadence sensors broadcast a CalculatedCadence that the profile HOLDS at
 * its last value when the crank stops (the cumulative revolution count and event
 * time stop advancing, so the library keeps recomputing the same number until a
 * timeout). That produces a "stuck" non-zero cadence (e.g. a flat 110 RPM) long
 * after the rider stopped. Downstream freshness logic can't catch it because the
 * stuck value is still > 0.
 *
 * This gate uses the cumulative revolution count as ground truth: cadence is only
 * real while the revolution count keeps changing. If it has not changed for longer
 * than its cadence-aware bounded window, the crank has stopped and we report 0.
 *
 * Pure and deterministic — `now` is injected so it is fully unit-testable.
 */
export function createCadenceGate({ revStaleMs = 2500, maxRevStaleMs = 6000 } = {}) {
  const state = new Map(); // deviceId -> { lastRevCount, lastRevChangeTs }

  return {
    /**
     * @param {string} deviceId
     * @param {{calculatedCadence: number|null, revolutionCount: number|null|undefined, now: number}} sample
     * @returns {number|null} the cadence to use (0 when the crank has stalled), or null if no cadence
     */
    gate(deviceId, { calculatedCadence, revolutionCount, now }) {
      const cadence = Number.isFinite(calculatedCadence) ? calculatedCadence : null;
      if (cadence === null) return null;

      // No revolution data → can't gate; trust the raw cadence.
      if (!Number.isFinite(revolutionCount)) return cadence;

      const prev = state.get(deviceId);
      if (!prev) {
        state.set(deviceId, { lastRevCount: revolutionCount, lastRevChangeTs: now });
        return cadence;
      }

      if (revolutionCount !== prev.lastRevCount) {
        // Any change (including a 16-bit wrap) means the crank turned.
        prev.lastRevCount = revolutionCount;
        prev.lastRevChangeTs = now;
        return cadence;
      }

      // Revolution count unchanged: real if still within a plausible inter-rev gap,
      // stopped (→ 0) once we exceed the staleness window.
      // Slow pedaling legitimately leaves several seconds between turns. Allow
      // one expected turn plus 25% packet tolerance, with a finite stop bound.
      // Held packets do not reset lastRevChangeTs, so they cannot mask a stop.
      const expectedTurnMs = cadence > 0 ? 60000 / cadence : 0;
      const staleMs = Math.max(revStaleMs, Math.min(maxRevStaleMs, expectedTurnMs * 1.25));
      if (now - prev.lastRevChangeTs > staleMs) return 0;
      return cadence;
    }
  };
}

export default createCadenceGate;
