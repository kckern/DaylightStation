const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;

/**
 * Plan the first scheduled Hero click so the click grid lands exactly on the
 * score's onset at leadInMs. `firstBeatIndex` lets the scheduler accent beat 1
 * even when the countdown begins partway through a measure.
 */
export function heroMetronomePlan({ elapsedMs = 0, leadInMs = 0, bpm, beatsPerBar = 4 }) {
  if (!(bpm > 0)) return { startDelayMs: 0, firstBeatIndex: 0 };
  const periodMs = 60000 / bpm;
  const beatNumber = Math.ceil(((elapsedMs || 0) - (leadInMs || 0)) / periodMs - 1e-9);
  const nextBeatMs = (leadInMs || 0) + beatNumber * periodMs;
  const startDelayMs = Math.max(0, nextBeatMs - (elapsedMs || 0));
  const bar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? Math.round(beatsPerBar) : 4;
  return {
    startDelayMs,
    firstBeatIndex: positiveModulo(beatNumber, bar),
  };
}

export default heroMetronomePlan;
