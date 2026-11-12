// Numbers set by the Phase 0 garage spike (2026-11-11). Nothing else in the
// game hard-codes these; every consumer reads this object.
//
// Measured so far: pose runs at about 13 fps on the garage box (CPU/wasm; the
// GPU backend is not benchmarked yet), so aim can be ~75 ms old when a frame
// uses it. Step-off/step-on firing ran at 1 to 1.3 presses per second.
export const INVADERS_TUNABLES = Object.freeze({
  fireIntervalS: 1.0,          // seconds per shot from step-off/step-on firing (conservative end of the measured range)
  reachabilityHitRate: 0.6,    // share of the bot's kills a level may demand
  aimLatchMs: 200,             // SPIKE: a shot uses the aim from this long before the press
  poseModelType: 'full',       // SPIKE: 'lite' when 'full' misses the fps gate
  poseBackend: null,           // SPIKE: null = detector default (wasm on Firefox)
  poseMinFps: 20,              // logged against, not enforced
  keypointMinScore: 0.3,
  poseLostAfterMs: 500,
  armsUpHoldMs: 300,           // scoring bonus only; play never requires raised arms
});
