import { BASE_CAMERA } from './povCamera.js';

// Tunables (kiosk-calibrated; adjust by feel).
const VANISH_TAU_MS = 450;   // lateral-lead ease time constant
const FOV_TAU_MS = 350;      // fov-pulse ease time constant
const LEAD_GAIN = 12;        // max % the vanishing point leans toward the leader lane
const FOV_GAIN = 0.5;        // depthRatio multiplier added at full normalized accel
const FOV_MAX = 1.5;         // clamp on the depthRatio multiplier
const ACCEL_REF = 6;         // accel (m/tick²) that maps to full FOV pulse

export const NEUTRAL_DYNAMICS = { vanishX: 50, fovMul: 1 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ease = (cur, target, dtMs, tau) => cur + (target - cur) * (1 - Math.exp(-dtMs / tau));

/**
 * Advance the cinematic camera state one frame toward its targets, derived from
 * smoothed race signals. Exponential ease (no overshoot) so the camera glides —
 * cinematic, never jittery. Offsets are bounded; the whole scene (grid + avatars)
 * uses them coherently, so the grid never deforms independently ("not jello").
 *
 * @param {{vanishX:number, fovMul:number}} state - previous dynamics
 * @param {{leaderLaneX:number, accel:number}} signals - leader lane (0..100), accel (m/tick²)
 * @param {number} dtMs - frame delta
 * @param {object} [cfg] - tunable overrides
 */
export function stepCameraDynamics(state, signals, dtMs, cfg = {}) {
  const s = state || NEUTRAL_DYNAMICS;
  const leaderLaneX = Number.isFinite(signals?.leaderLaneX) ? signals.leaderLaneX : 50;
  const accel = Number.isFinite(signals?.accel) ? signals.accel : 0;
  const leadGain = cfg.leadGain ?? LEAD_GAIN;
  const fovGain = cfg.fovGain ?? FOV_GAIN;
  const fovMax = cfg.fovMax ?? FOV_MAX;

  const targetVanish = 50 + clamp((leaderLaneX - 50) / 50, -1, 1) * leadGain;
  const targetFov = clamp(1 + clamp(accel / (cfg.accelRef ?? ACCEL_REF), 0, 1) * fovGain, 1, fovMax);

  return {
    vanishX: ease(s.vanishX, targetVanish, dtMs, cfg.vanishTau ?? VANISH_TAU_MS),
    fovMul: ease(s.fovMul, targetFov, dtMs, cfg.fovTau ?? FOV_TAU_MS)
  };
}

// Build a camera from the eased dynamics. farFrac stays fixed (the horizon does
// not breathe); only vanishX leans and depthRatio pulses.
export function cameraFrom(dyn) {
  const d = dyn || NEUTRAL_DYNAMICS;
  return { ...BASE_CAMERA, vanishX: d.vanishX, depthRatio: BASE_CAMERA.depthRatio * d.fovMul };
}

export default stepCameraDynamics;
