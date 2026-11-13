// Skyline Invaders aim gestures: eight ways to turn a BlazePose pose into a
// cannon position, plus `offset`, which is recorded for comparison and never
// offered to a player. Each is a pure function of one pose (and, where the
// gesture is about movement, of a small memory and a timestamp the caller
// threads through), so the game can run one and the trace recorder can
// compute every one from the same frame.
//
// All are measured in the PLAYER'S OWN BODY FRAME (aim.js `torsoFrame`): where
// the player stands, how big they appear and a tilted shoulder line do not
// move the cannon. None asks for hands above the head.
//
// A gesture's output is one of four kinds:
//   aim       a position 0..1 (0 = screen left); null = hold the last aim
//   velocity  screens per second; the caller integrates it
//   impulse   a velocity while a stroke lasts; the caller lets it glide after
//   hop       -1 / 0 / +1 lanes, edge-triggered
//
// | gesture   | kind     | the signal                                              |
// |-----------|----------|---------------------------------------------------------|
// | wiper     | aim      | forearm tilt from upright, elbow as the pivot           |
// | twist     | aim      | torso yaw: the 3-D shoulder line against the camera     |
// | wings     | aim      | roll of the wrist-to-wrist line, arms out wide          |
// | wheel     | aim      | the same roll with the hands close, on a steering wheel |
// | sprinkler | aim      | azimuth of the clasped hands from straight ahead (3-D)  |
// | drag      | velocity | wrist offset from the midline, past a dead zone         |
// | push      | impulse  | a fast outward swipe of a wrist                         |
// | hop       | hop      | one hand raised to the shoulder, or reached out sideways |
//
// Screen convention as in aim.js: the screen is a mirror, so the player's
// right is screen right and every "+" below means toward screen right.
import { DEFAULT_AIM_CONFIG, KP, armsWide, computeAim, torsoFrame } from './aim.js';
import { INVADERS_TUNABLES } from './tunables.js';

export const GESTURES = Object.freeze(['wiper', 'twist', 'wings', 'wheel', 'sprinkler', 'drag', 'push', 'hop']);
export const GESTURE_INFO = Object.freeze({
  wiper: Object.freeze({ kind: 'aim', label: 'Wipers', how: 'Elbows in, hands up. Tilt your forearms left and right like wipers.' }),
  twist: Object.freeze({ kind: 'aim', label: 'Twist', how: 'Arms straight out in front. Turn your whole body left and right.' }),
  wings: Object.freeze({ kind: 'aim', label: 'Wings', how: 'Arms out wide like a plane. Tip one wing down to bank that way.' }),
  wheel: Object.freeze({ kind: 'aim', label: 'Steering wheel', how: 'Hold a pretend steering wheel. Turn it left and right.' }),
  sprinkler: Object.freeze({ kind: 'aim', label: 'Sprinkler', how: 'Clasp your hands, arms straight out. Sweep them left and right.' }),
  drag: Object.freeze({ kind: 'velocity', label: 'Slide', how: 'Hold a hand out to one side and the cannon slides that way. Drop it to stop.' }),
  push: Object.freeze({ kind: 'impulse', label: 'Push', how: 'Swipe a hand fast to one side to shove the cannon. Swipe harder to shove it further.' }),
  hop: Object.freeze({ kind: 'hop', label: 'Hop', how: 'Lift one hand to your shoulder, or punch it out sideways. The cannon hops one lane that way.' }),
});
export const isGesture = (value) => GESTURES.includes(value);

/** The numbers every gesture reads, from the tunables. */
export const gestureConfig = (tunables = INVADERS_TUNABLES) => Object.freeze({
  ...DEFAULT_AIM_CONFIG,
  minScore: tunables.keypointMinScore,
  reach: tunables.offsetReachSw,
  downRatio: tunables.offsetDownRatio,
  calibration: null,
  wiperMaxDeg: tunables.wiperMaxDeg, wiperMinForearmSw: tunables.wiperMinForearmSw,
  twistMaxDeg: tunables.twistMaxDeg, twistSign: tunables.twistSign,
  wingsMaxDeg: tunables.wingsMaxDeg, wingsMinSpanSw: tunables.wingsMinSpanSw,
  wheelMaxDeg: tunables.wheelMaxDeg, wheelMinSpanSw: tunables.wheelMinSpanSw, wheelMaxSpanSw: tunables.wheelMaxSpanSw,
  sprinklerMaxDeg: tunables.sprinklerMaxDeg, sprinklerMinReachSw: tunables.sprinklerMinReachSw,
  dragDeadZoneSw: tunables.dragDeadZoneSw, dragFullSw: tunables.dragFullSw, dragMaxSpeed: tunables.dragMaxSpeed,
  pushMinSpeedSw: tunables.pushMinSpeedSw, pushGain: tunables.pushGain, pushMaxSpeed: tunables.pushMaxSpeed, pushCooldownMs: tunables.pushCooldownMs,
  hopRaiseDropSw: tunables.hopRaiseDropSw, hopLowerDropSw: tunables.hopLowerDropSw, hopReachSw: tunables.hopReachSw,
  hopReachReleaseSw: tunables.hopReachReleaseSw, hopRefractoryMs: tunables.hopRefractoryMs,
});

const DEG = 180 / Math.PI;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const finite3 = (kp, need3) => !!kp && Number.isFinite(kp.x) && Number.isFinite(kp.y) && (!need3 || Number.isFinite(kp.z));
const scoreOf = (kp) => (kp && Number.isFinite(kp.score) ? kp.score : 0);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const angleAim = (deg, maxDeg) => 0.5 + deg / (2 * maxDeg);
const wrapDeg = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
const NO_AIM = Object.freeze({ aim: null, raw: null });

// ── wiper ───────────────────────────────────────────────────────────────────
const NO_FOREARM = Object.freeze({ state: 'missing', score: 0, angleDeg: null, length: null });

/**
 * One forearm on the torso's own plane. state: 'ok' | 'missing' | 'low_score'
 * | 'down' (wrist not above its elbow) | 'short' (pointing at the camera).
 * angleDeg: 0 = upright, + = tilted toward screen right. length: the forearm's
 * length on that plane, in shoulder widths.
 */
function readForearm(body, k2, elbowIndex, wristIndex, config) {
  const elbow = body.points[elbowIndex];
  const wrist = body.points[wristIndex];
  const need3 = body.frame === '3d';
  if (!finite3(elbow, need3) || !finite3(wrist, need3)) return { ...NO_FOREARM };
  const score = Math.min(scoreOf(k2[elbowIndex]), scoreOf(k2[wristIndex]));
  const v = sub(wrist, elbow);
  // `along` points to the player's left (screen left) and `down` is down.
  const right = -dot(v, body.along);
  const up = -dot(v, body.down);
  const length = Math.hypot(right, up) / body.shoulderWidth;
  const angleDeg = Math.atan2(right, up) * DEG;
  let state = 'ok';
  if (score < config.minScore) state = 'low_score';
  else if (!(up > 0)) state = 'down';
  else if (length < config.wiperMinForearmSw) state = 'short';
  return { state, score, angleDeg, length };
}

/**
 * `wiper`: forearm tilt. Each usable forearm gives an angle from upright; the
 * aim is their score-weighted mean, with `wiperMaxDeg` at the screen edge. A
 * forearm is usable whenever its wrist is above its elbow and it is not
 * pointing at the camera, so an arm that sags while stepping still counts.
 * With none usable the aim is null (hold).
 */
export function readWiper(pose, config = gestureConfig(), body = torsoFrame(pose, config)) {
  const k2 = pose?.keypoints || [];
  const forearms = body?.down
    ? { left: readForearm(body, k2, KP.leftElbow, KP.leftWrist, config), right: readForearm(body, k2, KP.rightElbow, KP.rightWrist, config) }
    : { left: { ...NO_FOREARM }, right: { ...NO_FOREARM } };
  const list = [forearms.left, forearms.right];
  const perArm = list.map((arm) => (arm.state === 'ok' ? clamp01(angleAim(arm.angleDeg, config.wiperMaxDeg)) : null));
  const ok = list.filter((arm) => arm.state === 'ok');
  const weight = ok.reduce((sum, arm) => sum + arm.score, 0);
  if (!ok.length || !(weight > 0)) return { ...NO_AIM, angleDeg: null, arms: 0, perArm, forearms };
  const angleDeg = ok.reduce((sum, arm) => sum + arm.angleDeg * arm.score, 0) / weight;
  const raw = angleAim(angleDeg, config.wiperMaxDeg);
  return { aim: clamp01(raw), raw, angleDeg, arms: ok.length, perArm, forearms };
}

// ── twist ───────────────────────────────────────────────────────────────────
/**
 * `twist`: torso yaw. The 3-D shoulder line turns with the chest; its angle
 * against the camera's image plane is the aim, `twistMaxDeg` at the edge. The
 * arms are not read at all (they are held forward only so the turn is felt).
 *
 * Sign: turning toward the player's own right brings the LEFT shoulder toward
 * the camera. `torsoFrame().yawDeg` is atan2(z, x) of the right-to-left
 * shoulder vector, so with z smaller toward the camera (MediaPipe's world
 * landmarks) that turn is a NEGATIVE yaw, and `twistSign: -1` maps it to
 * screen right. Needs keypoints3D: without them the aim is null (hold).
 */
export function readTwist(pose, config = gestureConfig(), body = torsoFrame(pose, config)) {
  if (!body || body.frame !== '3d' || !Number.isFinite(body.yawDeg) || Math.abs(body.yawDeg) > 90) return { ...NO_AIM, yawDeg: body?.yawDeg ?? null };
  const turnDeg = config.twistSign * body.yawDeg;
  const raw = angleAim(turnDeg, config.twistMaxDeg);
  return { aim: clamp01(raw), raw, yawDeg: body.yawDeg, turnDeg };
}

// ── wings and wheel ─────────────────────────────────────────────────────────
/**
 * The wrist-to-wrist line against the shoulder line, in the image (flat to
 * the camera, where a roll is seen whole). rollDeg + = the player's right
 * hand lower than the left: a plane banking right, a wheel turned right.
 * spanSw: how far apart the wrists are, in shoulder widths. null without both
 * wrists and both shoulders.
 */
export function wristLineRoll(pose, config = gestureConfig()) {
  const k = pose?.keypoints || [];
  const [ls, rs, lw, rw] = [k[KP.leftShoulder], k[KP.rightShoulder], k[KP.leftWrist], k[KP.rightWrist]];
  if ([ls, rs, lw, rw].some((kp) => !finite3(kp, false) || scoreOf(kp) < config.minScore)) return null;
  const shoulders = { x: ls.x - rs.x, y: ls.y - rs.y };
  const wrists = { x: lw.x - rw.x, y: lw.y - rw.y };
  const sw = Math.hypot(shoulders.x, shoulders.y);
  const span = Math.hypot(wrists.x, wrists.y);
  if (!(sw > 0) || !(span > 0)) return null;
  // Image y is down: the right hand lower than the left turns the line clockwise on screen, a negative atan2.
  const rollDeg = -wrapDeg((Math.atan2(wrists.y, wrists.x) - Math.atan2(shoulders.y, shoulders.x)) * DEG);
  return { rollDeg, spanSw: span / sw };
}

/** `wings`: arms out wide, banked. Wrists closer than `wingsMinSpanSw`, or crossed, give no aim. */
export function readWings(pose, config = gestureConfig(), roll = wristLineRoll(pose, config)) {
  if (!roll || roll.spanSw < config.wingsMinSpanSw || Math.abs(roll.rollDeg) > 90) return { ...NO_AIM, rollDeg: roll?.rollDeg ?? null, spanSw: roll?.spanSw ?? null };
  const raw = angleAim(roll.rollDeg, config.wingsMaxDeg);
  return { aim: clamp01(raw), raw, ...roll };
}

/** `wheel`: hands on a steering wheel. Wrists outside `wheelMinSpanSw`..`wheelMaxSpanSw`, or crossed, give no aim. */
export function readWheel(pose, config = gestureConfig(), roll = wristLineRoll(pose, config)) {
  if (!roll || roll.spanSw < config.wheelMinSpanSw || roll.spanSw > config.wheelMaxSpanSw || Math.abs(roll.rollDeg) > 90) return { ...NO_AIM, rollDeg: roll?.rollDeg ?? null, spanSw: roll?.spanSw ?? null };
  const raw = angleAim(roll.rollDeg, config.wheelMaxDeg);
  return { aim: clamp01(raw), raw, ...roll };
}

// ── sprinkler ───────────────────────────────────────────────────────────────
/**
 * `sprinkler`: the direction the clasped hands point, as an angle from
 * straight ahead. In the 3-D torso frame the hands' midpoint sits `lateral`
 * to the side of the shoulder midpoint and `forward` in front of the chest;
 * the azimuth is atan2(lateral, forward), `sprinklerMaxDeg` at the edge. It
 * is an angle, so a long-armed adult and a child sweep the same range.
 * Forward is taken as a distance (the hands are never behind the chest), so
 * the sign of keypoints3D z does not matter. Needs keypoints3D and both
 * wrists; hands closer than `sprinklerMinReachSw` to the chest give no aim.
 */
export function readSprinkler(pose, config = gestureConfig(), body = torsoFrame(pose, config)) {
  const k2 = pose?.keypoints || [];
  const none = { ...NO_AIM, azimuthDeg: null, reachSw: null };
  if (!body || body.frame !== '3d' || !body.down) return none;
  if (scoreOf(k2[KP.leftWrist]) < config.minScore || scoreOf(k2[KP.rightWrist]) < config.minScore) return none;
  const lw = body.points[KP.leftWrist];
  const rw = body.points[KP.rightWrist];
  if (!finite3(lw, true) || !finite3(rw, true)) return none;
  const hands = sub({ x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2, z: (lw.z + rw.z) / 2 }, body.mid);
  const lateral = -dot(hands, body.along);
  const forward = Math.abs(dot(hands, cross(body.along, body.down)));
  const reachSw = Math.hypot(lateral, forward) / body.shoulderWidth;
  if (reachSw < config.sprinklerMinReachSw) return { ...none, reachSw };
  const azimuthDeg = Math.atan2(lateral, forward) * DEG;
  const raw = angleAim(azimuthDeg, config.sprinklerMaxDeg);
  return { aim: clamp01(raw), raw, azimuthDeg, reachSw };
}

// ── offset (recorded only) ──────────────────────────────────────────────────
/**
 * `offset`: where the wrists are, left or right of the shoulder midpoint, at
 * a fixed symmetric gain (the midline is the centre, `offsetReachSw` shoulder
 * widths out is the edge). This is the release-one gesture with its
 * calibration removed; it is computed on every frame for comparison and is
 * not offered to a player.
 *
 * When one arm drops out the aim does not jump to the other wrist: it carries
 * on from the last two-arm reading, moved by however far the remaining wrist
 * has moved since. `memory` holds that reading.
 * @param {object} read  a computeAim() result for the pose
 */
export function readOffset(read, memory = null, config = gestureConfig()) {
  const left = read?.arms?.left;
  const right = read?.arms?.right;
  const okLeft = left?.state === 'ok';
  const okRight = right?.state === 'ok';
  const toAim = (offset) => 0.5 + offset / (2 * config.reach);
  if (!okLeft && !okRight) return { signal: { ...NO_AIM, offset: null, arms: 0, continued: false }, memory: null };
  let offset;
  let continued = false;
  let next = memory;
  if (okLeft && okRight) {
    const weight = left.score + right.score;
    offset = weight > 0 ? (left.offset * left.score + right.offset * right.score) / weight : (left.offset + right.offset) / 2;
    next = { both: offset, left: left.offset, right: right.offset };
  } else {
    const side = okLeft ? 'left' : 'right';
    const arm = okLeft ? left : right;
    if (memory && Number.isFinite(memory.both) && Number.isFinite(memory[side])) {
      offset = memory.both + (arm.offset - memory[side]);
      continued = true;
    } else offset = arm.offset;
  }
  const raw = toAim(offset);
  return { signal: { aim: clamp01(raw), raw, offset, arms: (okLeft ? 1 : 0) + (okRight ? 1 : 0), continued }, memory: next };
}

// ── drag ────────────────────────────────────────────────────────────────────
/**
 * `drag`: rate control. `read.offset` is the mean wrist offset in shoulder
 * widths. Inside the dead zone, or with the arms down, the velocity is 0 and
 * the cannon stays where it is.
 * @returns {{ velocity: number, offset: number|null, arms: number }}  screens per second
 */
export function readDrag(read, config = gestureConfig()) {
  const offset = read && !read.lost && Number.isFinite(read.offset) ? read.offset : null;
  if (offset === null) return { velocity: 0, offset: null, arms: 0 };
  const beyond = Math.abs(offset) - config.dragDeadZoneSw;
  const span = Math.max(1e-6, config.dragFullSw - config.dragDeadZoneSw);
  const velocity = beyond <= 0 ? 0 : Math.sign(offset) * Math.min(1, beyond / span) * config.dragMaxSpeed;
  return { velocity, offset, arms: read.usableArms };
}

// ── push ────────────────────────────────────────────────────────────────────
const armOffset = (arm) => (arm && (arm.state === 'ok' || arm.state === 'down') && Number.isFinite(arm.offset) ? arm.offset : null);

/**
 * `push`: a swipe shoves the cannon. Each wrist's sideways speed is its
 * change in offset since the last frame, in shoulder widths per second. A
 * STROKE is a wrist moving faster than `pushMinSpeedSw` AWAY from the body
 * midline; while one lasts the cannon is driven at `pushGain` screens per
 * shoulder width of hand travel (capped at `pushMaxSpeed`), so a faster and
 * longer swipe carries it further. The caller lets the cannon glide on with
 * friction once the stroke ends.
 *
 * The hand coming back is ignored twice over: it moves toward the midline,
 * and for `pushCooldownMs` after a stroke one the opposite way is not
 * counted even if the hand overshoots the midline. A still hand does nothing.
 *
 * @param {object} read    a computeAim() result
 * @param {object|null} memory  what this returned last frame
 * @param {number} at      the frame's time, ms
 * @returns {{ signal: { velocity: number, stroke: boolean, started: boolean, wristVel: number }, memory: object }}
 *   velocity: the cannon speed to hold during a stroke (0 otherwise), screens
 *   per second. started: this frame began a stroke (the trigger event).
 *   wristVel: the faster wrist's signed speed, shoulder widths per second.
 */
export function readPush(read, memory = null, at = 0, config = gestureConfig()) {
  const offsets = [armOffset(read?.arms?.left), armOffset(read?.arms?.right)];
  const dt = memory && at > memory.at ? (at - memory.at) / 1000 : 0;
  let wristVel = 0;
  let outward = 0;       // the fastest outward speed among the wrists, signed
  offsets.forEach((offset, index) => {
    const before = memory?.offsets?.[index];
    if (offset === null || before == null || !(dt > 0) || dt > 0.5) return;
    const v = (offset - before) / dt;
    if (Math.abs(v) > Math.abs(wristVel)) wristVel = v;
    // Outward: moving the way the hand already is from the midline.
    if (v * offset > 0 && Math.abs(v) >= config.pushMinSpeedSw && Math.abs(v) > Math.abs(outward)) outward = v;
  });
  const direction = Math.sign(outward);
  const cooling = memory?.lastDirection && direction && direction !== memory.lastDirection && at - memory.lastStrokeAt < config.pushCooldownMs;
  const stroke = direction !== 0 && !cooling;
  const velocity = stroke ? direction * Math.min(config.pushMaxSpeed, Math.abs(outward) * config.pushGain) : 0;
  return {
    signal: { velocity, stroke, started: stroke && !memory?.stroke, wristVel },
    memory: {
      at, offsets, stroke,
      lastDirection: stroke ? direction : memory?.lastDirection || 0,
      lastStrokeAt: stroke ? at : memory?.lastStrokeAt ?? -Infinity,
    },
  };
}

// ── hop ─────────────────────────────────────────────────────────────────────
/**
 * `hop`: one lane per trigger. An arm triggers when its hand comes up to
 * about shoulder height (`hopRaiseDropSw`; never overhead) or reaches out
 * sideways on its own side (`hopReachSw`). The player's right arm hops right,
 * the left arm hops left. Each arm is edge-triggered: it must come back down
 * AND back in before it can trigger again. Both arms triggering on the same
 * frame is the arms-wide menu gesture, not a hop, and hops are at least
 * `hopRefractoryMs` apart.
 *
 * @returns {{ signal: { hop: -1|0|1, raised: boolean[], reached: boolean[] }, memory: object }}
 *   raised / reached are [left arm, right arm].
 */
export function readHop(read, memory = null, at = 0, config = gestureConfig()) {
  const arms = [read?.arms?.left, read?.arms?.right];
  const sides = [-1, 1];
  const raised = [];
  const reached = [];
  const armed = [];
  const fired = [];
  arms.forEach((arm, index) => {
    const seen = !!arm && (arm.state === 'ok' || arm.state === 'down') && Number.isFinite(arm.offset) && Number.isFinite(arm.drop);
    const wasArmed = memory?.armed?.[index] ?? false;
    if (!seen) { raised.push(false); reached.push(false); armed.push(wasArmed); fired.push(false); return; }
    const out = arm.offset * sides[index];          // how far out on its own side
    const isRaised = arm.drop <= config.hopRaiseDropSw;
    const isReached = out >= config.hopReachSw;
    const released = arm.drop >= config.hopLowerDropSw && out <= config.hopReachReleaseSw;
    raised.push(isRaised);
    reached.push(isReached);
    fired.push(wasArmed && (isRaised || isReached));
    armed.push(isRaised || isReached ? false : wasArmed || released);
  });
  const lastHopAt = memory?.lastHopAt ?? -Infinity;
  let hop = 0;
  if (fired[0] !== fired[1] && at - lastHopAt >= config.hopRefractoryMs) hop = fired[0] ? -1 : 1;
  return { signal: { hop, raised, reached }, memory: { armed, lastHopAt: hop ? at : lastHopAt } };
}

// ── lean (recorded only) ────────────────────────────────────────────────────
/**
 * Lean: the shoulder midpoint's sideways offset from the hip midpoint, in
 * shoulder widths, + = toward screen right. Recorded for comparison only; no
 * gesture uses it. null without both hips.
 */
export function readLean(pose, config = gestureConfig(), body = torsoFrame(pose, config)) {
  if (!body) return null;
  const k2 = pose?.keypoints || [];
  if (scoreOf(k2[KP.leftHip]) < config.minScore || scoreOf(k2[KP.rightHip]) < config.minScore) return null;
  const need3 = body.frame === '3d';
  const lh = body.points[KP.leftHip];
  const rh = body.points[KP.rightHip];
  if (!finite3(lh, need3) || !finite3(rh, need3)) return null;
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: ((lh.z || 0) + (rh.z || 0)) / 2 };
  return -dot(sub(body.mid, hipMid), body.along) / body.shoulderWidth;
}

/**
 * Every gesture's signal for one pose. `body` is whether the torso (both
 * shoulders) is in view: the game calls the player lost by that, not by the
 * arms. Thread `memory` from one call to the next; `at` is the frame's time
 * in ms (push and hop are about movement).
 */
export function readGestures(pose, memory = null, at = 0, config = gestureConfig()) {
  const body = torsoFrame(pose, config);
  const read = computeAim(pose, config);
  const roll = wristLineRoll(pose, config);
  const offset = readOffset(read, memory?.offset ?? null, config);
  const push = readPush(read, memory?.push ?? null, at, config);
  const hop = readHop(read, memory?.hop ?? null, at, config);
  return {
    body: !!body,
    frame: body?.frame ?? null,
    wiper: readWiper(pose, config, body),
    twist: readTwist(pose, config, body),
    wings: readWings(pose, config, roll),
    wheel: readWheel(pose, config, roll),
    sprinkler: readSprinkler(pose, config, body),
    drag: readDrag(read, config),
    push: push.signal,
    hop: hop.signal,
    offset: offset.signal,
    lean: readLean(pose, config, body),
    armsUp: read.armsUp,
    wide: armsWide(read),
    armStates: [read.arms.left.state, read.arms.right.state],
    memory: { offset: offset.memory, push: push.memory, hop: hop.memory },
  };
}
