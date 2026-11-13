import { describe, expect, it } from 'vitest';
import { KP, computeAim } from './aim.js';
import {
  GESTURES, GESTURE_INFO, gestureConfig, readDrag, readGestures, readHop, readLean, readOffset, readPush, readSprinkler,
  readTwist, readWheel, readWings, readWiper, wristLineRoll,
} from './gestures.js';
import { INVADERS_TUNABLES } from './tunables.js';

// Camera image, y down, not flipped: the player's LEFT side is at larger x.
// Shoulders 360 / 280: shoulder width 80, midline x = 320.
const SW = 80;
const MID = 320;
const SHOULDER_Y = 200;
const config = gestureConfig();

/**
 * A pose from plain numbers. Wrist `x` values are offsets from the midline in
 * shoulder widths, + = screen right (image left). `forearm` angles are degrees
 * from upright, + = screen right, pivoting on an elbow below each shoulder.
 */
function pose({ wrists = null, forearms = null, wristY = SHOULDER_Y, scores = {}, hips = 0, shift = 0, scale = 1 } = {}) {
  const k = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  const put = (index, x, y, score = 0.9) => { k[index] = { x: MID + shift + (x - MID) * scale, y: SHOULDER_Y + (y - SHOULDER_Y) * scale, score }; };
  put(KP.nose, MID, 140);
  put(KP.leftShoulder, 360, SHOULDER_Y, 0.95);
  put(KP.rightShoulder, 280, SHOULDER_Y, 0.95);
  // Elbows hang below the shoulders, the elbows-low posture.
  put(KP.leftElbow, 365, 290, scores.leftElbow ?? 0.9);
  put(KP.rightElbow, 275, 290, scores.rightElbow ?? 0.9);
  put(KP.leftHip, 345 - hips * SW, 400);
  put(KP.rightHip, 295 - hips * SW, 400);
  if (wrists) {
    if (wrists[0] != null) put(KP.leftWrist, MID - wrists[0] * SW, wristY, scores.left ?? 0.9);
    if (wrists[1] != null) put(KP.rightWrist, MID - wrists[1] * SW, wristY, scores.right ?? 0.9);
  }
  if (forearms) {
    const LENGTH = 60;
    const tip = (elbowX, deg) => ({ x: elbowX - LENGTH * Math.sin((deg * Math.PI) / 180), y: 290 - LENGTH * Math.cos((deg * Math.PI) / 180) });
    if (forearms[0] != null) { const p = tip(365, forearms[0]); put(KP.leftWrist, p.x, p.y, scores.left ?? 0.9); }
    if (forearms[1] != null) { const p = tip(275, forearms[1]); put(KP.rightWrist, p.x, p.y, scores.right ?? 0.9); }
  }
  return { keypoints: k };
}
const offsetOf = (p, memory = null) => readOffset(computeAim(p, config), memory, config);

// World landmarks: metres, y down, z smaller toward the camera. The player's
// LEFT side is at larger x, as in the image.
function world({ yawDeg = 0, hands = null } = {}) {
  const k3 = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const yaw = (yawDeg * Math.PI) / 180;
  // `turn` is toward the player's own right: the left shoulder comes forward (z smaller).
  const turn = (x, z) => ({ x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) });
  const put = (index, x, y, z) => { const p = turn(x, z); k3[index] = { x: p.x, y, z: p.z }; };
  put(KP.leftShoulder, 0.18, -0.5, 0);
  put(KP.rightShoulder, -0.18, -0.5, 0);
  put(KP.leftHip, 0.1, 0, 0);
  put(KP.rightHip, -0.1, 0, 0);
  if (hands) {
    // Clasped hands `reach` metres from the chest, `azimuthDeg` toward the player's right (smaller x).
    const az = (hands.azimuthDeg * Math.PI) / 180;
    const x = -hands.reach * Math.sin(az);
    const z = -hands.reach * Math.cos(az);
    put(KP.leftWrist, x + 0.03, -0.45, z);
    put(KP.rightWrist, x - 0.03, -0.45, z);
  }
  return k3;
}
const with3D = (p, k3) => ({ ...p, keypoints3D: k3 });

describe('gesture list', () => {
  it('offers eight gestures, each with a kind, a name and one line of how', () => {
    expect(GESTURES).toEqual(['wiper', 'twist', 'wings', 'wheel', 'sprinkler', 'drag', 'push', 'hop']);
    expect(GESTURES).not.toContain('offset');
    expect(INVADERS_TUNABLES.defaultGesture).toBe('wiper');
    for (const id of GESTURES) {
      expect(GESTURE_INFO[id].how.length).toBeGreaterThan(20);
      expect(['aim', 'velocity', 'impulse', 'hop']).toContain(GESTURE_INFO[id].kind);
    }
    expect(GESTURES.map((id) => GESTURE_INFO[id].kind)).toEqual(['aim', 'aim', 'aim', 'aim', 'aim', 'velocity', 'impulse', 'hop']);
  });
});

describe('wiper gesture', () => {
  it('reads upright forearms as the centre and 50 degrees as the edges', () => {
    expect(readWiper(pose({ forearms: [0, 0] }), config).aim).toBeCloseTo(0.5);
    expect(readWiper(pose({ forearms: [50, 50] }), config).aim).toBeCloseTo(1);
    expect(readWiper(pose({ forearms: [-50, -50] }), config).aim).toBeCloseTo(0);
    expect(readWiper(pose({ forearms: [25, 25] }), config).aim).toBeCloseTo(0.75);
    expect(readWiper(pose({ forearms: [25, 25] }), config).angleDeg).toBeCloseTo(25);
  });

  it('averages the two forearms and clamps past the edge', () => {
    expect(readWiper(pose({ forearms: [10, 30] }), config).aim).toBeCloseTo(0.7);
    const far = readWiper(pose({ forearms: [80, 80] }), config);
    expect(far.aim).toBe(1);
    expect(far.raw).toBeGreaterThan(1);
  });

  it('does not depend on where the player stands or how large they appear', () => {
    const here = readWiper(pose({ forearms: [20, 35] }), config).aim;
    expect(readWiper(pose({ forearms: [20, 35], shift: -120 }), config).aim).toBeCloseTo(here);
    expect(readWiper(pose({ forearms: [20, 35], scale: 0.6 }), config).aim).toBeCloseTo(here);
  });

  it('uses one forearm alone when the other is below its elbow or unseen', () => {
    const oneDown = readWiper(pose({ forearms: [170, 30] }), config);
    expect(oneDown.forearms.left.state).toBe('down');
    expect(oneDown.arms).toBe(1);
    expect(oneDown.aim).toBeCloseTo(0.8);
    const unseen = readWiper(pose({ forearms: [30, 30], scores: { left: 0.1 } }), config);
    expect(unseen.forearms.left.state).toBe('low_score');
    expect(unseen.aim).toBeCloseTo(0.8);
  });

  it('holds (no aim) when a forearm points at the camera or both are down', () => {
    const pointing = pose({ forearms: [0, 0] });
    // Wrists almost on top of the elbows: the forearm is foreshortened.
    pointing.keypoints[KP.leftWrist] = { x: 366, y: 282, score: 0.9 };
    pointing.keypoints[KP.rightWrist] = { x: 274, y: 282, score: 0.9 };
    const read = readWiper(pointing, config);
    expect(read.forearms.left.state).toBe('short');
    expect(read.aim).toBeNull();
    expect(readWiper(pose({ forearms: [180, 180] }), config).aim).toBeNull();
    expect(readWiper({ keypoints: [] }, config).aim).toBeNull();
  });

  it('measures in the 3-D torso frame when the pose carries world landmarks', () => {
    const p = pose({ forearms: [0, 0] });
    // Metres, hip-centred, y down. Forearms tilted 30 degrees toward the player's right (smaller x).
    const k3 = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
    k3[KP.leftShoulder] = { x: 0.18, y: -0.5, z: 0 };
    k3[KP.rightShoulder] = { x: -0.18, y: -0.5, z: 0 };
    k3[KP.leftElbow] = { x: 0.2, y: -0.25, z: 0 };
    k3[KP.rightElbow] = { x: -0.2, y: -0.25, z: 0 };
    const tilt = (elbow) => ({ x: elbow.x - 0.25 * Math.sin(Math.PI / 6), y: elbow.y - 0.25 * Math.cos(Math.PI / 6), z: -0.05 });
    k3[KP.leftWrist] = tilt(k3[KP.leftElbow]);
    k3[KP.rightWrist] = tilt(k3[KP.rightElbow]);
    const read = readWiper({ ...p, keypoints3D: k3 }, config);
    expect(read.angleDeg).toBeCloseTo(30, 0);
    expect(read.aim).toBeCloseTo(0.8, 1);
  });
});

describe('twist gesture', () => {
  const twistOf = (yawDeg) => readTwist(with3D(pose({ wrists: [0, 0] }), world({ yawDeg })), config);
  it('reads a square torso as the centre and a 35 degree turn as the edge', () => {
    expect(twistOf(0).aim).toBeCloseTo(0.5);
    expect(twistOf(35).aim).toBeCloseTo(1);
    expect(twistOf(-35).aim).toBeCloseTo(0);
    expect(twistOf(17.5).aim).toBeCloseTo(0.75);
    expect(twistOf(60).aim).toBe(1);
  });
  it('turning toward the player\'s own right steers to screen right (the mirror)', () => {
    const right = twistOf(20);
    expect(right.yawDeg).toBeCloseTo(-20);     // left shoulder nearer the camera = negative yaw
    expect(right.turnDeg).toBeCloseTo(20);
    expect(right.aim).toBeGreaterThan(0.5);
    expect(readTwist(with3D(pose(), world({ yawDeg: 20 })), { ...config, twistSign: 1 }).aim).toBeLessThan(0.5);
  });
  it('does not read the arms at all', () => {
    const noArms = with3D(pose(), world({ yawDeg: 10 }));
    expect(readTwist(noArms, config).aim).toBeCloseTo(twistOf(10).aim);
  });
  it('holds without world landmarks or without both shoulders', () => {
    expect(readTwist(pose({ wrists: [0, 0] }), config).aim).toBeNull();
    expect(readTwist(null, config).aim).toBeNull();
  });
});

describe('wings and wheel gestures', () => {
  // Wrists `span` shoulder widths apart, the line rolled `deg` (+ = the player's right hand lower).
  const rolled = (deg, span, { tilt = 0 } = {}) => {
    const p = pose({ wrists: [0, 0] });
    const half = (span * SW) / 2;
    const a = ((deg) * Math.PI) / 180;
    // Left wrist at larger x; a positive roll lifts it (smaller y) and drops the right wrist.
    p.keypoints[KP.leftWrist] = { x: MID + half * Math.cos(a), y: 220 - half * Math.sin(a), score: 0.9 };
    p.keypoints[KP.rightWrist] = { x: MID - half * Math.cos(a), y: 220 + half * Math.sin(a), score: 0.9 };
    if (tilt) {
      // Tilt the whole body in the image by `tilt` degrees about the midline.
      const t = (tilt * Math.PI) / 180;
      p.keypoints.forEach((kp) => { const dx = kp.x - MID; const dy = kp.y - 220; kp.x = MID + dx * Math.cos(t) - dy * Math.sin(t); kp.y = 220 + dx * Math.sin(t) + dy * Math.cos(t); });
    }
    return p;
  };
  it('measures the roll of the wrist line, + when the player\'s right hand is the lower one', () => {
    expect(wristLineRoll(rolled(0, 3), config)).toMatchObject({ rollDeg: expect.closeTo(0, 5), spanSw: expect.closeTo(3, 5) });
    expect(wristLineRoll(rolled(20, 3), config).rollDeg).toBeCloseTo(20);
    expect(wristLineRoll(rolled(-20, 0.6), config).rollDeg).toBeCloseTo(-20);
    expect(wristLineRoll(pose(), config)).toBeNull();
  });
  it('is measured against the shoulder line, so a tilted body or camera cancels', () => {
    expect(wristLineRoll(rolled(15, 3, { tilt: 12 }), config).rollDeg).toBeCloseTo(15);
  });
  it('wings: level is the centre, a 30 degree bank is the edge, and it needs the arms out wide', () => {
    expect(readWings(rolled(0, 3.2), config).aim).toBeCloseTo(0.5);
    expect(readWings(rolled(30, 3.2), config).aim).toBeCloseTo(1);
    expect(readWings(rolled(-30, 3.2), config).aim).toBeCloseTo(0);
    expect(readWings(rolled(15, 3.2), config).aim).toBeCloseTo(0.75);
    expect(readWings(rolled(15, 1.2), config)).toMatchObject({ aim: null, rollDeg: expect.closeTo(15, 5) });
  });
  it('wheel: level is the centre, a 45 degree turn is the edge, and it needs the hands close but not touching', () => {
    expect(readWheel(rolled(0, 0.8), config).aim).toBeCloseTo(0.5);
    expect(readWheel(rolled(45, 0.8), config).aim).toBeCloseTo(1);
    expect(readWheel(rolled(-45, 0.8), config).aim).toBeCloseTo(0);
    expect(readWheel(rolled(22.5, 0.8), config).aim).toBeCloseTo(0.75);
    expect(readWheel(rolled(20, 0.1), config).aim).toBeNull();
    expect(readWheel(rolled(20, 3), config).aim).toBeNull();
  });
  it('both hold when the hands cross or a wrist is unseen', () => {
    expect(readWheel(rolled(120, 0.8), config).aim).toBeNull();
    expect(readWings(rolled(120, 3), config).aim).toBeNull();
    const unseen = rolled(10, 0.8);
    unseen.keypoints[KP.leftWrist].score = 0.1;
    expect(readWheel(unseen, config)).toMatchObject({ aim: null, rollDeg: null });
  });
});

describe('sprinkler gesture', () => {
  const sprinklerOf = (azimuthDeg, { reach = 0.5, yawDeg = 0 } = {}) => readSprinkler(with3D(pose({ wrists: [0, 0] }), world({ yawDeg, hands: { azimuthDeg, reach } })), config);
  it('reads hands straight ahead as the centre and 40 degrees as the edge', () => {
    expect(sprinklerOf(0).aim).toBeCloseTo(0.5);
    expect(sprinklerOf(40).aim).toBeCloseTo(1);
    expect(sprinklerOf(-40).aim).toBeCloseTo(0);
    expect(sprinklerOf(20).aim).toBeCloseTo(0.75);
    expect(sprinklerOf(20).azimuthDeg).toBeCloseTo(20);
  });
  it('is an angle, not a distance: long arms and short arms sweep the same range', () => {
    expect(sprinklerOf(25, { reach: 0.35 }).aim).toBeCloseTo(sprinklerOf(25, { reach: 0.65 }).aim);
  });
  it('is measured from the torso: turning the whole body with the arms does not move it', () => {
    expect(sprinklerOf(15, { yawDeg: 25 }).aim).toBeCloseTo(sprinklerOf(15).aim);
  });
  it('holds with the hands at the chest, without world landmarks, or without both wrists', () => {
    expect(sprinklerOf(30, { reach: 0.1 }).aim).toBeNull();
    expect(readSprinkler(pose({ wrists: [0, 0] }), config).aim).toBeNull();
    const oneHand = with3D(pose({ wrists: [0, 0], scores: { left: 0.1 } }), world({ hands: { azimuthDeg: 20, reach: 0.5 } }));
    expect(readSprinkler(oneHand, config).aim).toBeNull();
  });
});

describe('drag gesture', () => {
  const dragOf = (p) => readDrag(computeAim(p, config), config);
  it('does not move inside the dead zone', () => {
    expect(dragOf(pose({ wrists: [0, 0] })).velocity).toBe(0);
    expect(dragOf(pose({ wrists: [0.25, 0.25] })).velocity).toBe(0);
    expect(dragOf(pose({ wrists: [-0.29, -0.29] })).velocity).toBe(0);
  });
  it('speeds up with the offset, to 0.8 screens a second at full deflection, either way', () => {
    expect(dragOf(pose({ wrists: [1, 1] })).velocity).toBeCloseTo(0.8);
    expect(dragOf(pose({ wrists: [2, 2] })).velocity).toBeCloseTo(0.8);
    expect(dragOf(pose({ wrists: [-1, -1] })).velocity).toBeCloseTo(-0.8);
    expect(dragOf(pose({ wrists: [0.65, 0.65] })).velocity).toBeCloseTo(0.4);
  });
  it('stops with the arms down or unseen', () => {
    const down = pose({ wrists: [1, 1], wristY: SHOULDER_Y + 1.5 * SW });
    expect(dragOf(down)).toMatchObject({ velocity: 0, offset: null, arms: 0 });
    expect(dragOf(pose({ wrists: [1, 1], scores: { left: 0, right: 0 } })).velocity).toBe(0);
  });
  it('lets one arm out to the side drag alone while the other hangs', () => {
    const p = pose({ wrists: [0, 1] });
    p.keypoints[KP.leftWrist].y = SHOULDER_Y + 1.5 * SW;
    expect(dragOf(p).velocity).toBeCloseTo(0.8);
  });
});

describe('push gesture', () => {
  // Feed wrist offsets (shoulder widths, both hands together) at 100 ms steps.
  const feed = (offsets, { stepMs = 100, start = null } = {}) => {
    let memory = start;
    const out = [];
    offsets.forEach((o, i) => {
      const p = Array.isArray(o) ? pose({ wrists: o }) : pose({ wrists: [o, o] });
      const next = readPush(computeAim(p, config), memory, 1000 + i * stepMs, config);
      memory = next.memory;
      out.push(next.signal);
    });
    return { out, memory };
  };
  it('a still hand does nothing, wherever it is held', () => {
    const { out } = feed([0.9, 0.9, 0.9, 0.9]);
    expect(out.every((s) => s.velocity === 0 && !s.stroke)).toBe(true);
  });
  it('a slow drift does nothing', () => {
    const { out } = feed([0.2, 0.3, 0.4, 0.5]);   // 1 shoulder width a second
    expect(out.every((s) => !s.stroke)).toBe(true);
    expect(out[2].wristVel).toBeCloseTo(1);
  });
  it('a fast outward swipe starts a stroke that drives the cannon that way', () => {
    const { out } = feed([0.1, 0.5, 0.9]);        // 4 shoulder widths a second, to the right
    expect(out[1]).toMatchObject({ stroke: true, started: true });
    expect(out[1].velocity).toBeCloseTo(4 * config.pushGain);
    expect(out[1].wristVel).toBeCloseTo(4);
    expect(out[2]).toMatchObject({ stroke: true, started: false });
    const left = feed([-0.1, -0.5]).out[1];
    expect(left.velocity).toBeCloseTo(-4 * config.pushGain);
  });
  it('a harder swipe pushes harder, up to the cap', () => {
    expect(feed([0.1, 0.4]).out[1].velocity).toBeLessThan(feed([0.1, 0.6]).out[1].velocity);
    expect(feed([0.1, 1.5]).out[1].velocity).toBe(2.5);
  });
  it('ignores the hand coming back toward the midline', () => {
    const { out } = feed([0.1, 0.6, 1.1, 0.6, 0.1]);
    expect(out.map((s) => s.stroke)).toEqual([false, true, true, false, false]);
    expect(out[3].wristVel).toBeCloseTo(-5);
    expect(out[3].velocity).toBe(0);
  });
  it('ignores a return stroke that overshoots the midline, inside the cooldown', () => {
    const { out, memory } = feed([0.1, 0.6, 0.1, -0.4]);          // back through the middle within 200 ms
    expect(out[3]).toMatchObject({ stroke: false, velocity: 0 });
    // After the cooldown a swipe the other way counts.
    const later = readPush(computeAim(pose({ wrists: [-0.9, -0.9] }), config), { ...memory, at: 1800, offsets: [-0.4, -0.4] }, 1900, config);
    expect(later.signal.stroke).toBe(true);
    expect(later.signal.velocity).toBeLessThan(0);
  });
  it('one hand is enough, and a gap in the pose starts no stroke', () => {
    expect(feed([[0, 0.1], [0, 0.6]]).out[1].stroke).toBe(true);
    expect(feed([0.1, 0.9], { stepMs: 900 }).out[1].stroke).toBe(false);
  });
});

describe('hop gesture', () => {
  // [left arm, right arm] as { out: shoulder widths out on its own side, drop: shoulder widths below the shoulder }.
  const DOWN = { out: 0.6, drop: 1.4 };
  const arms = (left = DOWN, right = DOWN) => {
    const p = pose({ wrists: [-left.out, right.out] });
    p.keypoints[KP.leftWrist].y = SHOULDER_Y + left.drop * SW;
    p.keypoints[KP.rightWrist].y = SHOULDER_Y + right.drop * SW;
    return computeAim(p, config);
  };
  const run = (frames, stepMs = 100) => {
    let memory = null;
    return frames.map((frame, i) => { const next = readHop(frame, memory, 1000 + i * stepMs, config); memory = next.memory; return next.signal.hop; });
  };
  const RAISED = { out: 0.6, drop: 0 };
  const REACHED = { out: 1.5, drop: 0.6 };

  it('raising the right hand to the shoulder hops right once; the left hand hops left', () => {
    expect(run([arms(), arms(DOWN, RAISED), arms(DOWN, RAISED), arms(DOWN, RAISED)])).toEqual([0, 1, 0, 0]);
    expect(run([arms(), arms(RAISED, DOWN)])).toEqual([0, -1]);
  });
  it('a sideways reach hops too', () => {
    expect(run([arms(), arms(DOWN, REACHED), arms(DOWN, REACHED)])).toEqual([0, 1, 0]);
    expect(run([arms(), arms(REACHED, DOWN)])).toEqual([0, -1]);
  });
  it('is edge-triggered: the hand must come down and in before it hops again', () => {
    const halfway = { out: 0.6, drop: 0.3 };
    expect(run([arms(), arms(DOWN, RAISED), arms(DOWN, halfway), arms(DOWN, RAISED), arms(), arms(), arms(), arms(DOWN, RAISED)])).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
  });
  it('a hand already up when the game starts does not hop until it has been lowered once', () => {
    expect(run([arms(DOWN, RAISED), arms(DOWN, RAISED), arms(), arms(DOWN, RAISED)])).toEqual([0, 0, 0, 1]);
  });
  it('waits out the refractory period between hops', () => {
    expect(run([arms(), arms(DOWN, RAISED), arms(), arms(DOWN, RAISED)], 100)).toEqual([0, 1, 0, 0]);   // 200 ms apart
    expect(run([arms(), arms(DOWN, RAISED), arms(), arms(DOWN, RAISED)], 200)).toEqual([0, 1, 0, 1]);   // 400 ms apart
  });
  it('both arms out at once is the arms-wide menu gesture, not a hop', () => {
    expect(run([arms(), arms(REACHED, REACHED)])).toEqual([0, 0]);
  });
  it('never needs a hand above the head: shoulder height is enough', () => {
    const signal = readHop(arms(DOWN, { out: 0.6, drop: 0.1 }), { armed: [true, true], lastHopAt: -Infinity }, 5000, config).signal;
    expect(signal).toMatchObject({ hop: 1, raised: [false, true] });
  });
});

describe('offset (recorded for comparison, not offered)', () => {
  it('is symmetric with a fixed gain: the midline is the centre, 1.2 shoulder widths is the edge', () => {
    expect(offsetOf(pose({ wrists: [0, 0] })).signal.aim).toBeCloseTo(0.5);
    expect(offsetOf(pose({ wrists: [1.2, 1.2] })).signal.aim).toBeCloseTo(1);
    expect(offsetOf(pose({ wrists: [-1.2, -1.2] })).signal.aim).toBeCloseTo(0);
    expect(offsetOf(pose({ wrists: [0.6, 0.6] })).signal.aim).toBeCloseTo(0.75);
    expect(offsetOf(pose({ wrists: [-0.6, -0.6] })).signal.aim).toBeCloseTo(0.25);
  });

  it('clamps the aim but reports how far past the edge the hands are', () => {
    const { signal } = offsetOf(pose({ wrists: [2, 2] }));
    expect(signal.aim).toBe(1);
    expect(signal.raw).toBeGreaterThan(1.2);
  });

  it('does not depend on where the player stands or how large they appear', () => {
    const here = offsetOf(pose({ wrists: [0.5, 0.7] })).signal.aim;
    expect(offsetOf(pose({ wrists: [0.5, 0.7], shift: 140 })).signal.aim).toBeCloseTo(here);
    expect(offsetOf(pose({ wrists: [0.5, 0.7], scale: 0.5 })).signal.aim).toBeCloseTo(here);
  });

  it('carries on from the last two-arm reading when one arm drops, instead of jumping to the other wrist', () => {
    // Hands apart (left wrist at -0.2, right wrist at +0.6): the mean is +0.2.
    const both = offsetOf(pose({ wrists: [-0.2, 0.6] }));
    expect(both.signal.offset).toBeCloseTo(0.2);
    // The left arm drops. The right wrist has not moved: the aim must not move.
    const one = offsetOf(pose({ wrists: [null, 0.6] }), both.memory);
    expect(one.signal.arms).toBe(1);
    expect(one.signal.continued).toBe(true);
    expect(one.signal.offset).toBeCloseTo(0.2);
    // The remaining wrist moves 0.3 to the right: so does the aim.
    const moved = offsetOf(pose({ wrists: [null, 0.9] }), one.memory);
    expect(moved.signal.offset).toBeCloseTo(0.5);
  });

  it('treats a hanging arm as dropped, and uses a lone wrist as it is with no two-arm reading to go on', () => {
    const hanging = pose({ wrists: [0.4, 0.4] });
    hanging.keypoints[KP.leftWrist].y = SHOULDER_Y + 1.5 * SW;
    const { signal } = offsetOf(hanging);
    expect(signal.arms).toBe(1);
    expect(signal.continued).toBe(false);
    expect(signal.offset).toBeCloseTo(0.4);
  });

  it('gives no aim with no usable arm, and forgets the two-arm reading', () => {
    const both = offsetOf(pose({ wrists: [0.3, 0.3] }));
    const none = offsetOf(pose({ wrists: [0.3, 0.3], scores: { left: 0.1, right: 0.1 } }), both.memory);
    expect(none.signal).toMatchObject({ aim: null, offset: null, arms: 0 });
    expect(none.memory).toBeNull();
  });
});

describe('lean and the combined read', () => {
  it('measures the shoulders against the hips, + toward screen right', () => {
    expect(readLean(pose({ wrists: [0, 0] }), config)).toBeCloseTo(0);
    // Hips moved to screen right: the shoulders lean left of them.
    expect(readLean(pose({ wrists: [0, 0], hips: 0.5 }), config)).toBeCloseTo(-0.5);
    const noHips = pose({ wrists: [0, 0] });
    noHips.keypoints[KP.leftHip].score = 0;
    expect(readLean(noHips, config)).toBeNull();
  });

  it('computes every gesture from one frame, offered or not, and threads the memories', () => {
    const first = readGestures(pose({ forearms: [20, 20] }), null, 1000, config);
    expect(first.body).toBe(true);
    expect(first.wiper.aim).toBeCloseTo(0.7);
    for (const id of ['twist', 'wings', 'wheel', 'sprinkler', 'offset']) expect(first[id]).toHaveProperty('aim');
    expect(first.drag.velocity).toEqual(expect.any(Number));
    expect(first.push).toMatchObject({ velocity: 0, stroke: false, wristVel: 0 });
    expect(first.hop).toMatchObject({ hop: 0 });
    expect(first.lean).toBeCloseTo(0);
    expect(first.armStates).toEqual(['ok', 'ok']);
    expect(first.memory).toMatchObject({ offset: { both: expect.any(Number) }, push: { at: 1000 }, hop: { armed: expect.any(Array) } });
    const second = readGestures(pose({ wrists: [0.9, 0.9] }), { ...first.memory, push: { ...first.memory.push, offsets: [0.4, 0.4] } }, 1100, config);
    expect(second.push.stroke).toBe(true);
    expect(readGestures(null, first.memory, 1200, config)).toMatchObject({ body: false, offset: { aim: null }, wiper: { aim: null }, twist: { aim: null }, drag: { velocity: 0 }, push: { stroke: false }, hop: { hop: 0 }, lean: null });
  });
});
