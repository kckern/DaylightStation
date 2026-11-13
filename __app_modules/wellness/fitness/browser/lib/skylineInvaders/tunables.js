// Every number the game is tuned by. Nothing else in the game hard-codes these;
// every consumer reads this object.
//
// Pose and mat numbers come from the Phase 0 garage spike (2026-11-11): pose
// runs at about 13 fps on the garage box (CPU/wasm), so aim can be ~75 ms old
// when a frame uses it, and step-off/step-on ran at 1 to 1.3 presses a second.
// Gesture, lane, fuel and power numbers are first guesses from the 2026-11-12
// play session (19 rounds, none passed); the pose and shot traces exist to
// replace them with measured values.
export const INVADERS_TUNABLES = Object.freeze({
  // ── Pose ──────────────────────────────────────────────────────────────────
  poseModelType: 'full',       // 'lite' when 'full' misses the fps gate
  poseBackend: null,           // null = detector default (wasm on Firefox)
  poseMinFps: 20,              // logged against, not enforced
  keypointMinScore: 0.3,       // below this a keypoint is not used
  poseLostAfterMs: 800,        // no torso (both shoulders) for this long = lost
  armsUpHoldMs: 300,           // scoring bonus only; play never requires raised arms
  aimSmoothingMs: 120,         // time constant of the one aim filter

  // ── Gestures (gestures.js) ────────────────────────────────────────────────
  defaultGesture: 'wiper',     // played with when a rider has not picked one (the intro was skipped)
  // wiper: forearm tilt
  wiperMaxDeg: 50,             // forearm tilt from upright that maps to the screen edge
  wiperMinForearmSw: 0.3,      // a forearm shorter than this on the torso plane points at the camera
  // twist: torso yaw
  twistMaxDeg: 35,             // shoulder-line yaw that maps to the screen edge
  twistSign: -1,               // -1: keypoints3D z is smaller toward the camera (MediaPipe's convention). Flip if a right turn steers left.
  // wings: arms out, banked
  wingsMaxDeg: 30,             // roll of the wrist-to-wrist line against the shoulder line that maps to the edge
  wingsMinSpanSw: 1.5,         // wrists closer together than this are not wings
  // wheel: hands on a steering wheel
  wheelMaxDeg: 45,             // tilt of the wrist-to-wrist line that maps to the edge
  wheelMinSpanSw: 0.25,        // wrists closer than this: the line's angle is noise
  wheelMaxSpanSw: 1.5,         // wrists further apart than this are wings, not a wheel
  // sprinkler: clasped hands swept left and right
  sprinklerMaxDeg: 40,         // azimuth of the hands from straight ahead that maps to the edge
  sprinklerMinReachSw: 0.5,    // hands closer to the chest than this give no direction
  // drag: hand offset sets velocity
  dragDeadZoneSw: 0.3,         // wrist offset inside this does not move the cannon
  dragFullSw: 1.0,             // wrist offset at or past this moves it at full speed
  dragMaxSpeed: 0.8,           // full speed, in screens per second
  // push: a fast outward swipe shoves the cannon, which then glides
  pushMinSpeedSw: 2.0,         // wrist speed (shoulder widths per second) that starts a stroke
  pushGain: 0.3,               // screens of cannon travel per shoulder width of swipe
  pushMaxSpeed: 2.5,           // cap on the cannon's speed, in screens per second
  pushFrictionMs: 220,         // time constant of the glide after a stroke
  pushSettleSpeed: 0.08,       // below this (screens per second) the cannon stops on its lane
  pushCooldownMs: 250,         // after a stroke, a stroke the other way is the hand coming back: ignored this long
  // hop: one lane per trigger
  hopRaiseDropSw: 0.15,        // a wrist no more than this far below its shoulder is "raised"
  hopLowerDropSw: 0.5,         // and must drop past this before it can trigger again
  hopReachSw: 1.3,             // a wrist this far out on its own side is a "reach"
  hopReachReleaseSw: 0.9,      // and must come back inside this before it can trigger again
  hopRefractoryMs: 350,        // minimum time between hops
  // offset: recorded for comparison only, never offered to a player
  offsetReachSw: 1.2,          // wrists this many shoulder widths off the midline = screen edge
  offsetDownRatio: 1.1,        // a wrist this far below its shoulder is hanging, not pointing (also drag, push, hop)

  // ── Lanes (lanes.js) ──────────────────────────────────────────────────────
  lanes: 8,                    // columns across the aim range; threats spawn on their centres
  laneHysteresis: 0.25,        // share of a lane the aim must cross into the next before the cannon moves
  stepLaneFreezeMs: 150,       // the cannon's lane holds this long after a mat step (stepping throws the arms); 0 = off

  // ── Fire (engine.js, rules.js `fireRules`) ────────────────────────────────
  fuelPerStepS: 1.5,           // seconds of stream one mat step buys
  fuelCapS: 5,                 // the tank
  streamIntervalS: 0.25,       // seconds between volleys while there is fuel
  powerPerKill: 0.08,          // power meter per kill (a full meter is 1)
  powerPerFiringS: 0.03,       // power meter per second of firing
  weaponIdleDropS: 8,          // stream idle this long: the weapon drops a level and the meter empties

  // ── Reachability bot (levels.js) ──────────────────────────────────────────
  botStepIntervalS: 1.0,       // seconds between the bot's mat steps (conservative end of the measured range)
  botDecisionS: 1.0,           // how often the bot re-chooses its lane
  botLaneErrorRate: 0.4,       // share of threats the bot lines up one lane off for, and so lets through
  botLaneMoveS: 0.35,          // seconds the bot takes to move the cannon one lane
  reachabilitySeeds: Object.freeze([1, 2, 3]),   // the check holds on the worst of these
  reachabilityHitRate: 0.6,    // share of the bot's kills a level may demand
  reachabilityBaseHpMargin: 15,   // a level may ask for at most the bot's skyline minus this

  // ── Setup: choose a method, then the test sweep (setupTest.js, useInvadersSetup.js) ──
  setupHoldMs: 400,            // the cannon must rest on an edge this long for the step to count
  setupStepTimeoutS: 15,       // a step not detected in this long stops the test: try again or choose another
  setupPassedMs: 1500,         // "It works!" stays up this long before the game goes on

  // ── Aim help during a round (SkylineInvaders.jsx) ─────────────────────────
  aimHelpLostS: 3,             // the defender out of view this long: say so and offer Controls
  aimHelpStuckS: 12,           // in view but the cannon has not changed lane this long: offer Controls

  // ── Trace recorder (traceRecorder.js) ─────────────────────────────────────
  traceHz: 10,                 // pose rows per second
  traceBatchMs: 20000,         // one event per batch: the log ingest allows 3 a minute per event name
});
