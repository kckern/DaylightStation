import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AIM_CONFIG, KP, offsetToAimX, armAngleDeg, armsWide, calibrationFromSamples, computeAim, createAimHistory,
  createAimSmoother, latchAfter, latchBefore, wristsAboveHead, wristsAboveShoulders,
} from './aim.js';

// Camera image, y down, not flipped: the player's RIGHT side is at smaller x.
const SHOULDER_Y = 200;
const L_SHOULDER = { x: 360, y: SHOULDER_Y };
const R_SHOULDER = { x: 280, y: SHOULDER_Y };
const ARM = 120;

/** Wrist position for an arm pointing `screenDeg` from vertical in mirrored screen space. */
const wristFor = (shoulder, screenDeg) => {
  const rad = (screenDeg * Math.PI) / 180;
  // screen-right (+) is image-left (-x).
  return { x: shoulder.x - ARM * Math.sin(rad), y: shoulder.y - ARM * Math.cos(rad) };
};

function poseWith({ left = 0, right = 0, score = 0.9, leftScore = score, rightScore = score, nose = { x: 320, y: 140, score: 0.9 } } = {}) {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  keypoints[KP.nose] = nose;
  keypoints[KP.leftShoulder] = { ...L_SHOULDER, score: 0.95 };
  keypoints[KP.rightShoulder] = { ...R_SHOULDER, score: 0.95 };
  if (left != null) keypoints[KP.leftWrist] = { ...wristFor(L_SHOULDER, left), score: leftScore };
  if (right != null) keypoints[KP.rightWrist] = { ...wristFor(R_SHOULDER, right), score: rightScore };
  return { keypoints };
}

describe('arm angle and mapping', () => {
  it('measures from straight up, mirrored', () => {
    expect(armAngleDeg({ x: 100, y: 100 }, { x: 100, y: 0 })).toBeCloseTo(0);
    // Wrist toward smaller image x = the player's right = screen right.
    expect(armAngleDeg({ x: 100, y: 100 }, { x: 0, y: 100 })).toBeCloseTo(90);
    expect(armAngleDeg({ x: 100, y: 100 }, { x: 200, y: 100 })).toBeCloseTo(-90);
    expect(Math.abs(armAngleDeg({ x: 100, y: 100 }, { x: 100, y: 200 }))).toBeCloseTo(180);
  });

  it('maps an offset in shoulder widths onto 0..1 (+ = the player\'s right = screen right)', () => {
    // default reach 1.5: 1.5 shoulder widths out is the edge.
    expect(offsetToAimX(0)).toBeCloseTo(0.5);
    expect(offsetToAimX(1.5)).toBeCloseTo(1);
    expect(offsetToAimX(-1.5)).toBeCloseTo(0);
    expect(offsetToAimX(1, { reach: 1 })).toBeCloseTo(1);
  });

  it('maps through a per-player calibration when one is given', () => {
    const config = { ...DEFAULT_AIM_CONFIG, calibration: { left: -1, right: 2 } };
    expect(offsetToAimX(-1, config)).toBeCloseTo(0);
    expect(offsetToAimX(0.5, config)).toBeCloseTo(0.5);
    expect(offsetToAimX(2, config)).toBeCloseTo(1);
  });
});

// Shoulders 360/280: width 80, midline 320. A wrist placed directly in image x.
const at = (lx, rx, { y = SHOULDER_Y, leftScore = 0.9, rightScore = 0.9 } = {}) => {
  const pose = poseWith({ left: 0, right: 0 });
  pose.keypoints[KP.leftWrist] = { x: lx, y, score: leftScore };
  pose.keypoints[KP.rightWrist] = { x: rx, y, score: rightScore };
  return pose;
};

describe('computeAim', () => {
  it('centers when both arms reach toward the screen (wrists over the shoulders)', () => {
    const aim = computeAim(at(L_SHOULDER.x - 10, R_SHOULDER.x + 10));
    expect(aim.lost).toBe(false);
    expect(aim.usableArms).toBe(2);
    expect(aim.aimX).toBeCloseTo(0.5);
  });

  it('does not need the arms raised: waist-height forward reach also centers', () => {
    expect(computeAim(at(330, 310, { y: SHOULDER_Y + 60 })).aimX).toBeCloseTo(0.5);
  });

  it('moves toward screen right when the player reaches to their right', () => {
    expect(computeAim(at(260, 260)).aimX).toBeCloseTo(0.75);
    expect(computeAim(at(380, 380)).aimX).toBeCloseTo(0.25);
  });

  it('reaches the edge with an arm fully out to the side', () => {
    expect(computeAim(poseWith({ left: 90, right: 90 })).aimX).toBeCloseTo(1);
    expect(computeAim(poseWith({ left: -90, right: -90 })).aimX).toBeCloseTo(0);
  });

  it('clamps aimX but reports the unclamped value', () => {
    const aim = computeAim(at(100, 100));
    expect(aim.aimX).toBe(1);
    expect(aim.rawX).toBeCloseTo(0.5 + 220 / 240);
  });

  it('weights the arms by keypoint score', () => {
    const aim = computeAim(at(320, 200, { leftScore: 0.9, rightScore: 0.45 }));
    expect(aim.aimX).toBeCloseTo((0.5 * 0.9 + 1 * 0.45) / 1.35);
  });

  it('uses the one usable arm', () => {
    const lowScore = computeAim(at(260, 400, { rightScore: 0.1 }));
    expect(lowScore.usableArms).toBe(1);
    expect(lowScore.arms.right.state).toBe('low_score');
    expect(lowScore.aimX).toBeCloseTo(0.75);

    const hanging = computeAim(poseWith({ left: -90, right: 175 }));
    expect(hanging.arms.right.state).toBe('down');
    expect(hanging.aimX).toBe(0);
  });

  it('judges loss by score, not by keypoint presence', () => {
    const stale = computeAim(poseWith({ left: 20, right: 20, score: DEFAULT_AIM_CONFIG.minScore - 0.01 }));
    expect(stale.lost).toBe(true);
    expect(stale.aimX).toBeNull();
    // Geometry is still reported for the trace.
    expect(stale.arms.left.angleDeg).toBeCloseTo(20);
  });

  it('is lost with no pose, missing wrists, or both arms down', () => {
    expect(computeAim(null).lost).toBe(true);
    expect(computeAim({ keypoints: [] }).arms.left.state).toBe('missing');
    expect(computeAim(poseWith({ left: 170, right: -170 })).lost).toBe(true);
  });

  it('accepts an arm pointed at the camera (it reads as near center)', () => {
    const pose = poseWith({ left: 0, right: 0 });
    pose.keypoints[KP.rightWrist] = { x: R_SHOULDER.x - 3, y: R_SHOULDER.y - 5, score: 0.9 };
    const aim = computeAim(pose);
    expect(aim.arms.right.state).toBe('ok');
    expect(aim.usableArms).toBe(2);
  });

  it('has no aim without both shoulders', () => {
    const pose = poseWith({ left: 0, right: 0 });
    pose.keypoints[KP.leftShoulder] = { ...L_SHOULDER, score: 0.1 };
    expect(computeAim(pose).lost).toBe(true);
  });
});

describe('posture checks', () => {
  it('detects both wrists above the head', () => {
    expect(wristsAboveHead(poseWith({ left: 0, right: 0 }))).toBe(true);
    expect(wristsAboveHead(poseWith({ left: 80, right: -80 }))).toBe(false);
    expect(wristsAboveHead(poseWith({ left: 0, right: 0, rightScore: 0.1 }))).toBeNull();
    expect(wristsAboveHead(null)).toBeNull();
  });

  it('detects wrists above shoulders', () => {
    expect(wristsAboveShoulders(poseWith({ left: 80, right: -80 }))).toBe(true);
    expect(wristsAboveShoulders(poseWith({ left: 80, right: 150 }))).toBe(false);
  });
});

describe('smoother', () => {
  it('converges at a rate set by elapsed time, not frame count', () => {
    const fast = createAimSmoother({ tauMs: 100 });
    const slow = createAimSmoother({ tauMs: 100 });
    fast.push(0, 0);
    slow.push(0, 0);
    for (let t = 10; t <= 100; t += 10) fast.push(1, t);
    slow.push(1, 100);
    expect(slow.value).toBeCloseTo(1 - Math.exp(-1), 5);
    expect(fast.value).toBeCloseTo(slow.value, 5);
  });

  it('holds the last value through loss and forgets on reset', () => {
    const s = createAimSmoother();
    s.push(0.4, 0);
    expect(s.push(null, 50)).toBeCloseTo(0.4);
    s.reset();
    expect(s.push(0.9, 60)).toBeCloseTo(0.9);
  });
});

describe('aim history and latch', () => {
  const filled = () => {
    const h = createAimHistory({ horizonMs: 3000 });
    // 30 Hz ramp: x rises 0.001 per ms from t=0.
    for (let t = 0; t <= 1000; t += 33) h.push({ t, x: t / 1000, xs: t / 2000, lost: false });
    return h;
  };

  it('returns the latest sample at or before a time and trims the horizon', () => {
    const h = filled();
    expect(h.at(100).t).toBe(99);
    expect(h.at(-1)).toBeNull();
    h.push({ t: 5000, x: 1, xs: 1, lost: false });
    expect(h.length).toBe(1);
  });

  it('reports how far the aim moved before the press', () => {
    const report = latchBefore(filled(), 1000, 'x');
    expect(report.atPress).toBeCloseTo(0.99, 2);
    expect(report.before[200]).toBeCloseTo(0.792, 3);
    expect(report.throw[200]).toBeCloseTo(0.198, 3);
    expect(report.throw[400]).toBeCloseTo(0.396, 3);
    expect(report.range400).toBeCloseTo(0.363, 3);
    expect(report.sampleAgeMs).toBe(10);
    expect(report.lostSamples).toBe(0);
    expect(latchBefore(filled(), 1000, 'xs').throw[200]).toBeCloseTo(0.099, 3);
  });

  it('returns nulls rather than guesses when there is no history', () => {
    const report = latchBefore(createAimHistory(), 500);
    expect(report.atPress).toBeNull();
    expect(report.throw[200]).toBeNull();
    expect(report.range400).toBeNull();
  });

  it('reports drift after the press only for offsets that have elapsed', () => {
    const h = filled();
    const early = latchAfter(h, 500, 720, 'x');
    expect(early.drift[100]).toBeCloseTo(0.099, 3);
    expect(early.drift[200]).toBeCloseTo(0.198, 3);
    expect(early.drift[300]).toBeNull();
    expect(early.observedMs).toBe(220);
    expect(latchAfter(h, 500, 1000, 'x').drift[400]).toBeCloseTo(0.396, 3);
  });
});

// ---------------------------------------------------------------------------
// Torso-relative aim. A synthetic player described in their OWN frame, then
// turned, tilted, moved and scaled before the camera sees them.
//   side: metres toward the player's own LEFT (+) / RIGHT (-), from the sternum
//   down: metres below the shoulder line
//   fwd:  metres out in front of the chest
// Camera space: x = image right, y = down, z = away from the camera. The player
// faces the camera, so their left is image-right and "forward" is -z.
// ---------------------------------------------------------------------------
const SW = 0.36; // shoulder width, metres
const rad = (deg) => (deg * Math.PI) / 180;

function player({
  left = { side: SW / 2, down: 0, fwd: 0.45 }, right = { side: -SW / 2, down: 0, fwd: 0.45 },
  yaw = 0, tilt = 0, scale = 300, cx = 320, cy = 200, with3D = true,
  leftScore = 0.9, rightScore = 0.9, leftDepthError = 0, rightDepthError = 0,
} = {}) {
  const toCamera = ({ side, down, fwd }) => {
    const x0 = side * Math.cos(rad(yaw)) + fwd * Math.sin(rad(yaw));
    const z = side * Math.sin(rad(yaw)) - fwd * Math.cos(rad(yaw));
    return { x: x0 * Math.cos(rad(tilt)) - down * Math.sin(rad(tilt)), y: x0 * Math.sin(rad(tilt)) + down * Math.cos(rad(tilt)), z };
  };
  const points = {
    [KP.leftShoulder]: { p: toCamera({ side: SW / 2, down: 0, fwd: 0 }), score: 0.95 },
    [KP.rightShoulder]: { p: toCamera({ side: -SW / 2, down: 0, fwd: 0 }), score: 0.95 },
    [KP.leftWrist]: { p: toCamera(left), score: leftScore, dz: leftDepthError },
    [KP.rightWrist]: { p: toCamera(right), score: rightScore, dz: rightDepthError },
  };
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  const keypoints3D = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, score: 0 }));
  Object.entries(points).forEach(([index, { p, score, dz = 0 }]) => {
    keypoints[index] = { x: cx + scale * p.x, y: cy + scale * p.y, score };
    keypoints3D[index] = { x: p.x, y: p.y, z: p.z + dz, score };
  });
  return with3D ? { keypoints, keypoints3D } : { keypoints };
}

const both = (side, down, fwd) => ({ left: { side, down, fwd }, right: { side, down, fwd } });
const HANGING = (sideSign) => ({ side: sideSign * (SW / 2 + 0.03), down: 0.55, fwd: 0.02 });

describe.each([['3-D torso frame', true], ['2-D fallback', false]])('torso-relative aim: %s', (_label, with3D) => {
  const aimOf = (spec) => computeAim(player({ ...spec, with3D }));

  it('says which frame it measured in', () => {
    expect(aimOf({}).frame).toBe(with3D ? '3d' : '2d');
  });

  it('centers on a forward reach at chest height and at waist height', () => {
    expect(aimOf({}).aimX).toBeCloseTo(0.5, 6);
    expect(aimOf({ left: { side: SW / 2, down: 0.35, fwd: 0.4 }, right: { side: -SW / 2, down: 0.35, fwd: 0.4 } }).aimX).toBeCloseTo(0.5, 6);
    // hands together in front of the sternum
    expect(aimOf(both(0, 0.15, 0.4)).aimX).toBeCloseTo(0.5, 6);
  });

  it('reaches the edges with both hands out to one side, at any height', () => {
    for (const down of [-0.1, 0, 0.3]) {
      expect(aimOf(both(-1.5 * SW, down, 0.1)).aimX).toBeCloseTo(1, 6); // the player's right = screen right
      expect(aimOf(both(1.5 * SW, down, 0.1)).aimX).toBeCloseTo(0, 6);
    }
    expect(aimOf(both(-0.75 * SW, 0.2, 0.3)).aimX).toBeCloseTo(0.75, 6);
  });

  it('does not move when the player stands elsewhere in the frame or appears larger or smaller', () => {
    const spec = both(-0.6 * SW, 0.1, 0.3);
    const home = aimOf(spec).aimX;
    expect(home).toBeCloseTo(0.7, 6);
    expect(aimOf({ ...spec, cx: 90, cy: 310 }).aimX).toBeCloseTo(home, 6);
    expect(aimOf({ ...spec, scale: 120 }).aimX).toBeCloseTo(home, 6);
    expect(aimOf({ ...spec, scale: 640, cx: 500, cy: 80 }).aimX).toBeCloseTo(home, 6);
  });

  it('does not move when the shoulder line is tilted', () => {
    for (const spec of [{}, both(-0.6 * SW, 0.1, 0.3), both(0.9 * SW, 0, 0.2)]) {
      const level = aimOf(spec).aimX;
      for (const tilt of [-20, -10, 10, 20]) expect(aimOf({ ...spec, tilt }).aimX).toBeCloseTo(level, 6);
    }
  });

  it('lets the other arm aim when one arm hangs', () => {
    const rightHangs = aimOf({ left: { side: 1.5 * SW, down: 0, fwd: 0.1 }, right: HANGING(-1) });
    expect(rightHangs.arms.right.state).toBe('down');
    expect(rightHangs.usableArms).toBe(1);
    expect(rightHangs.aimX).toBeCloseTo(0, 6);
    const leftHangs = aimOf({ left: HANGING(1), right: { side: -0.75 * SW, down: 0.1, fwd: 0.3 }, tilt: 12 });
    expect(leftHangs.arms.left.state).toBe('down');
    expect(leftHangs.aimX).toBeCloseTo(0.75, 6);
  });

  it('lets the other arm aim when one arm is occluded (low score)', () => {
    const aim = aimOf({ left: { side: 0.75 * SW, down: 0, fwd: 0.3 }, right: { side: -2 * SW, down: 0, fwd: 0 }, rightScore: 0.1 });
    expect(aim.arms.right.state).toBe('low_score');
    expect(aim.usableArms).toBe(1);
    expect(aim.aimX).toBeCloseTo(0.25, 6);
  });

  it('is lost when both arms hang', () => {
    expect(aimOf({ left: HANGING(1), right: HANGING(-1) }).lost).toBe(true);
  });
});

describe('torso yaw', () => {
  // Hands fixed relative to the chest while the torso turns.
  const POSES = [
    ['forward reach, chest height', {}],
    ['forward reach, waist height', both(0, 0.35, 0.4)],
    ['half right', both(-0.6 * SW, 0.1, 0.3)],
    ['half left, one arm', { left: { side: 0.8 * SW, down: 0.05, fwd: 0.25 }, right: HANGING(-1) }],
  ];

  it.each(POSES)('holds the aim within 0.001 through +/-25 deg of turn: %s', (_name, spec) => {
    const square = computeAim(player(spec)).aimX;
    for (const yaw of [-25, -15, 15, 25]) {
      const turned = computeAim(player({ ...spec, yaw }));
      expect(turned.frame).toBe('3d');
      expect(Math.abs(turned.aimX - square)).toBeLessThan(0.001);
    }
  });

  it('holds within 0.001 when turned and tilted together', () => {
    const spec = both(-0.6 * SW, 0.1, 0.3);
    const square = computeAim(player(spec)).aimX;
    expect(Math.abs(computeAim(player({ ...spec, yaw: 25, tilt: -12, scale: 150, cx: 480 })).aimX - square)).toBeLessThan(0.001);
  });

  it('stays within 0.025 at 25 deg when the wrist depth estimate is off by 5 cm', () => {
    const square = computeAim(player({})).aimX;
    for (const error of [-0.05, 0.05]) {
      const turned = computeAim(player({ yaw: 25, leftDepthError: error, rightDepthError: error }));
      expect(Math.abs(turned.aimX - square)).toBeLessThan(0.025);
    }
  });

  it('is unaffected by wrist depth error when the player is square to the camera', () => {
    expect(computeAim(player({ leftDepthError: 0.2, rightDepthError: -0.2 })).aimX).toBeCloseTo(0.5, 6);
  });

  it('reports the turn and the shoulder tilt for the trace', () => {
    expect(computeAim(player({})).yawDeg).toBeCloseTo(0, 6);
    expect(Math.abs(computeAim(player({ yaw: 25 })).yawDeg)).toBeCloseTo(25, 4);
    expect(Math.sign(computeAim(player({ yaw: 25 })).yawDeg)).toBe(-Math.sign(computeAim(player({ yaw: -25 })).yawDeg));
    expect(Math.abs(computeAim(player({ tilt: 10 })).tiltDeg)).toBeCloseTo(10, 4);
  });

  it('LIMIT: without 3-D keypoints a 25 deg turn drags a forward reach well off center', () => {
    const turned = computeAim(player({ yaw: 25, with3D: false }));
    expect(turned.frame).toBe('2d');
    expect(turned.yawDeg).toBeNull();
    expect(Math.abs(turned.aimX - 0.5)).toBeGreaterThan(0.1);
  });

  it('falls back to 2-D when the 3-D shoulders are unusable or 3-D is switched off', () => {
    const pose = player({});
    pose.keypoints3D[KP.leftShoulder] = { x: NaN, y: 0, z: 0, score: 0.9 };
    expect(computeAim(pose).frame).toBe('2d');
    expect(computeAim(pose).aimX).toBeCloseTo(0.5, 6);
    expect(computeAim(player({ yaw: 25 }), { ...DEFAULT_AIM_CONFIG, use3D: false }).frame).toBe('2d');
    expect(computeAim({ keypoints: player({}).keypoints, keypoints3D: [] }).frame).toBe('2d');
  });
});

describe('game-facing fields (plan Task 20)', () => {
  it('reports the offset in shoulder widths, toward screen right', () => {
    expect(computeAim(player(both(-0.6 * SW, 0.1, 0.3))).offset).toBeCloseTo(0.6, 6);
    expect(computeAim(player(both(0.9 * SW, 0, 0.2))).offset).toBeCloseTo(-0.9, 6);
    expect(computeAim(null).offset).toBeNull();
  });

  it('reports each arm for two cannons: [player-left arm, player-right arm], clamped, null when unusable', () => {
    const aim = computeAim(player({ left: { side: 0.75 * SW, down: 0, fwd: 0.3 }, right: { side: -3 * SW, down: 0, fwd: 0 } }));
    expect(aim.perArm[0]).toBeCloseTo(0.25, 6);
    expect(aim.perArm[1]).toBe(1);
    expect(computeAim(player({ right: HANGING(-1) })).perArm[1]).toBeNull();
    expect(computeAim(null).perArm).toEqual([null, null]);
  });

  it('reports a score: the mean of the usable arms', () => {
    expect(computeAim(player({ leftScore: 0.9, rightScore: 0.5 })).score).toBeCloseTo(0.7, 6);
    expect(computeAim(player({ leftScore: 0.9, rightScore: 0.1 })).score).toBeCloseTo(0.9, 6);
    expect(computeAim(null).score).toBe(0);
  });

  it('reports arms up only when every usable wrist is above its shoulder', () => {
    expect(computeAim(player(both(0, -0.2, 0.3))).armsUp).toBe(true);
    expect(computeAim(player({ left: { side: 0.2, down: -0.2, fwd: 0.3 }, right: { side: -0.2, down: 0.2, fwd: 0.3 } })).armsUp).toBe(false);
    expect(computeAim(player({ left: { side: 0.2, down: -0.2, fwd: 0.3 }, right: HANGING(-1) })).armsUp).toBe(true);
    expect(computeAim(null).armsUp).toBe(false);
  });

  it('maps through a calibration: the calibrated far reaches are the screen edges', () => {
    const calibration = calibrationFromSamples({ offset: -1.2 }, { offset: 0.9 });
    const config = { ...DEFAULT_AIM_CONFIG, calibration };
    expect(computeAim(player(both(1.2 * SW, 0, 0.2)), config).aimX).toBeCloseTo(0, 6);
    expect(computeAim(player(both(-0.9 * SW, 0, 0.2)), config).aimX).toBeCloseTo(1, 6);
    expect(computeAim(player(both(-2 * SW, 0, 0.2)), config).aimX).toBe(1);
    // the offset itself is calibration-free, so calibration can be captured from it
    expect(computeAim(player(both(-0.9 * SW, 0, 0.2)), config).offset).toBeCloseTo(0.9, 6);
  });

  it('builds a calibration from far-left and far-right samples, order-proof, and rejects a small span', () => {
    expect(calibrationFromSamples({ offset: -1.2 }, { offset: 0.9 })).toEqual({ left: -1.2, right: 0.9 });
    expect(calibrationFromSamples({ offset: 0.9 }, { offset: -1.2 })).toEqual({ left: -1.2, right: 0.9 });
    expect(calibrationFromSamples({ offset: 0.1 }, { offset: 0.6 })).toBeNull();
    expect(calibrationFromSamples({ offset: null }, { offset: 1 })).toBeNull();
    expect(calibrationFromSamples(null, undefined)).toBeNull();
  });
});

describe('arms-wide gesture (the spike\'s hands-free "next")', () => {
  const wide = (leftSide, rightSide, extra = {}) => computeAim(player({
    left: { side: leftSide, down: 0.05, fwd: 0.05 }, right: { side: rightSide, down: 0.05, fwd: 0.05 }, ...extra,
  }));

  it('is true with both arms held out to their own sides, at any height, without going overhead', () => {
    expect(armsWide(wide(0.6, -0.6))).toBe(true);
    expect(armsWide(computeAim(player({ left: { side: 0.55, down: 0.3, fwd: 0 }, right: { side: -0.55, down: 0.3, fwd: 0 } })))).toBe(true);
    expect(armsWide(wide(0.6, -0.6, { yaw: 20, tilt: 8 }))).toBe(true);
  });

  it('is false for aiming postures and for arms at rest', () => {
    expect(armsWide(computeAim(player({})))).toBe(false);                      // forward reach
    expect(armsWide(computeAim(player(both(-1.5 * SW, 0, 0.1))))).toBe(false); // both hands to one side
    expect(armsWide(computeAim(player({ left: HANGING(1), right: HANGING(-1) })))).toBe(false);
    expect(armsWide(wide(0.6, -0.2))).toBe(false);
  });

  it('cannot say when an arm is not scored or there is no body', () => {
    expect(armsWide(wide(0.6, -0.6, { rightScore: 0.1 }))).toBeNull();
    expect(armsWide(computeAim(null))).toBeNull();
    expect(armsWide(null)).toBeNull();
  });
});
