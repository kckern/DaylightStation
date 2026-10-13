/**
 * Pure cue resolution for CYCLE challenges. HR challenges keep their existing
 * path in GovernanceEngine._computeAudioDuck; this only covers the cycle branch,
 * which previously produced no SFX at all.
 *
 * Edge cues (start/end/fail) come from the snapshot's `cycleAudioCue` field,
 * which GovernanceEngine already edge-detects each tick. The "hurry" cue is new:
 * it fires when the rider has dropped below the red zone (loRpm) and health is
 * dropping, gated by a cooldown so a needle that crosses the line repeatedly
 * does not retrigger the SFX.
 */

export const CYCLE_HURRY_COOLDOWN_MS = 8000;

const CYCLE_EDGE_TO_TRIGGER = {
  cycle_challenge_init: 'cycle_start',
  cycle_success: 'cycle_end',
  cycle_locked: 'cycle_fail'
};

/**
 * @param {object} snap - the cycle challenge snapshot (type === 'cycle')
 * @param {{now:number, cooldownUntil?:number, cooldownMs?:number}} ctx
 * @returns {{trigger: string|null, cooldownUntil: number}}
 */
export function resolveCycleAudioCue(snap, { now, cooldownUntil = 0, cooldownMs = CYCLE_HURRY_COOLDOWN_MS } = {}) {
  const edge = CYCLE_EDGE_TO_TRIGGER[snap?.cycleAudioCue];
  if (edge) return { trigger: edge, cooldownUntil };

  const phase = snap?.currentPhase;
  const belowRed = phase && Number.isFinite(snap?.currentRpm) && snap.currentRpm < phase.loRpm;
  const healthDropping = Number.isFinite(snap?.cycleHealthPct) && snap.cycleHealthPct < 1;
  if (belowRed && healthDropping && !(cooldownUntil > now)) {
    return { trigger: 'cycle_hurry', cooldownUntil: now + cooldownMs };
  }
  return { trigger: null, cooldownUntil };
}

export default resolveCycleAudioCue;
