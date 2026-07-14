/**
 * countIn — pure plan for a one-measure metronome count-in before a graded/play-
 * along run. Given the piece's meter (beats per measure) and the run tempo, it
 * returns the beat count and per-beat period so the player can click the user in
 * before the transport starts. DOM-free, unit-testable.
 */

/**
 * @param {{ beats?: number, bpm?: number, tempoMult?: number }} p
 *   beats = numerator of the time signature (beats per measure); bpm = written
 *   opening tempo; tempoMult = the user's tempo multiplier.
 * @returns {{ beats: number, periodMs: number, totalMs: number }}
 */
export function countInPlan({ beats, bpm, tempoMult = 1 }) {
  const b = Number.isFinite(beats) && beats >= 2 && beats <= 12 ? beats : 4; // sane meter, else common time
  const effBpm = (bpm > 0 ? bpm : 90) * (tempoMult > 0 ? tempoMult : 1);
  const periodMs = 60000 / effBpm;
  return { beats: b, periodMs, totalMs: b * periodMs };
}

export default { countInPlan };
