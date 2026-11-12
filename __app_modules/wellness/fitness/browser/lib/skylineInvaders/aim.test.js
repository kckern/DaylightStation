import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AIM_CONFIG, KP, offsetToAimX, armAngleDeg, computeAim, createAimHistory, createAimSmoother,
  latchAfter, latchBefore, wristsAboveHead, wristsAboveShoulders,
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

  it('maps the wrist offset from the midline onto 0..1, mirrored', () => {
    // shoulder width 80, default reach 1.5 -> 120 px from the midline is the edge.
    expect(offsetToAimX(320, 320, 80)).toBeCloseTo(0.5);
    expect(offsetToAimX(200, 320, 80)).toBeCloseTo(1); // player's right = image left = screen right
    expect(offsetToAimX(440, 320, 80)).toBeCloseTo(0);
    expect(offsetToAimX(240, 320, 80, { reach: 1 })).toBeCloseTo(1);
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
