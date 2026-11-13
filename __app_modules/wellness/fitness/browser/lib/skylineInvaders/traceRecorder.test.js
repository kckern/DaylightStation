import { describe, expect, it } from 'vitest';
import { KP } from './aim.js';
import { GESTURES, gestureConfig, readGestures } from './gestures.js';
import {
  ARM_STATE_CODES, POSE_TRACE_COLS, SHOT_TRACE_COLS, TRACE_KEYPOINTS_2D, TRACE_KEYPOINTS_3D, createTraceRecorder, poseTraceRow,
} from './traceRecorder.js';
import { INVADERS_TUNABLES } from './tunables.js';

const col = (row, name) => row[POSE_TRACE_COLS.indexOf(name)];
const shotCol = (row, name) => row[SHOT_TRACE_COLS.indexOf(name)];

// Wiper pose: forearms tilted `deg` from upright (+ = screen right), with world landmarks.
function pose(deg = 0) {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  const put = (index, x, y, score = 0.9) => { keypoints[index] = { x, y, score }; };
  put(KP.nose, 320, 120); put(KP.leftShoulder, 380.4, 200); put(KP.rightShoulder, 260, 200);
  put(KP.leftElbow, 390, 300); put(KP.rightElbow, 250, 300); put(KP.leftHip, 350, 420); put(KP.rightHip, 290, 420);
  const rad = (deg * Math.PI) / 180;
  put(KP.leftWrist, 390 - 80 * Math.sin(rad), 300 - 80 * Math.cos(rad), 0.876);
  put(KP.rightWrist, 250 - 80 * Math.sin(rad), 300 - 80 * Math.cos(rad));
  const keypoints3D = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  keypoints3D[KP.leftShoulder] = { x: 0.1804, y: -0.5, z: -0.012 };
  keypoints3D[KP.rightShoulder] = { x: -0.18, y: -0.5, z: 0.012 };
  // Forearms in the world frame, tilted the same way as in the image.
  for (const [elbow, wrist, x] of [[KP.leftElbow, KP.leftWrist, 0.2], [KP.rightElbow, KP.rightWrist, -0.2]]) {
    keypoints3D[elbow] = { x, y: -0.25, z: 0 };
    keypoints3D[wrist] = { x: x - 0.25 * Math.sin(rad), y: -0.25 - 0.25 * Math.cos(rad), z: 0 };
  }
  return { keypoints, keypoints3D };
}
const frameOf = (p, at = 1000, memory = null) => ({ at, pose: p, signals: readGestures(p, memory, at, gestureConfig()) });
const sample = (over = {}) => ({ raw: 0.7, lane: 5, lost: false, ...over });

function setup(tunables = INVADERS_TUNABLES) {
  let t = 100_000;
  const sent = [];
  const recorder = createTraceRecorder({ emit: (name, data) => sent.push({ name, data }), now: () => t, tunables });
  return { recorder, sent, tick: (ms) => { t += ms; }, at: () => t, of: (name) => sent.filter((event) => event.name === name).map((event) => event.data) };
}
const HEADER = { kind: 'round', runId: 'run-1', levelId: 'invaders-1-1', shooterId: 'kid', gesture: 'wiper' };

describe('pose trace row', () => {
  it('names a column for every value, with the ten image keypoints and six world keypoints the brief asks for', () => {
    expect(TRACE_KEYPOINTS_2D).toEqual([11, 12, 13, 14, 15, 16, 19, 20, 23, 24]);
    expect(TRACE_KEYPOINTS_3D).toEqual([11, 12, 13, 14, 15, 16]);
    expect(POSE_TRACE_COLS).toHaveLength(1 + 10 * 3 + 6 * 3 + 6 + 9 + 7);
    expect(new Set(POSE_TRACE_COLS).size).toBe(POSE_TRACE_COLS.length);
    expect(poseTraceRow(frameOf(pose(25)), sample(), { t0: 1000 })).toHaveLength(POSE_TRACE_COLS.length);
  });
  it('writes integers: px, score x100, world mm', () => {
    const row = poseTraceRow(frameOf(pose(0), 1250), sample(), { t0: 1000 });
    expect(col(row, 'dt')).toBe(250);
    expect([col(row, 'k11x'), col(row, 'k11y'), col(row, 'k11s')]).toEqual([380, 200, 90]);
    expect(col(row, 'k15s')).toBe(88);
    expect([col(row, 'w11x'), col(row, 'w11y'), col(row, 'w11z')]).toEqual([180, -500, -12]);
    for (const value of row) expect(value === null || Number.isInteger(value)).toBe(true);
  });
  it('records every gesture\'s signal from the same frame, whichever is active', () => {
    const row = poseTraceRow(frameOf(pose(25)), sample(), { t0: 1000 });
    expect(col(row, 'wiper')).toBe(750);
    expect(col(row, 'twist')).toEqual(expect.any(Number));          // world shoulders are there
    expect(col(row, 'yaw')).toEqual(expect.any(Number));
    expect(col(row, 'offset')).toEqual(expect.any(Number));
    expect(col(row, 'roll')).toEqual(expect.any(Number));
    expect(col(row, 'dragVel')).toEqual(expect.any(Number));
    expect(col(row, 'pushVel')).toBe(0);
    expect(col(row, 'lean')).toEqual(expect.any(Number));
    for (const id of GESTURES.filter((g) => !['drag', 'push', 'hop'].includes(g))) expect(POSE_TRACE_COLS).toContain(id);
  });
  it('writes null where a gesture would hold, and the cannon as it stands', () => {
    const noArms = pose(0);
    noArms.keypoints[KP.leftWrist].score = 0;
    noArms.keypoints[KP.rightWrist].score = 0;
    const row = poseTraceRow(frameOf(noArms), sample({ raw: 0.31, lane: 2, lost: false }), { t0: 1000, cannonX: 335 });
    expect([col(row, 'wiper'), col(row, 'wings'), col(row, 'offset')]).toEqual([null, null, null]);
    expect([col(row, 'raw'), col(row, 'lane'), col(row, 'cannonX'), col(row, 'lost')]).toEqual([310, 2, 335, 0]);
    expect([col(row, 'armL'), col(row, 'armR')]).toEqual([ARM_STATE_CODES.low_score, ARM_STATE_CODES.low_score]);
  });
  it('writes a row of nulls with the lost flag when nobody is in view', () => {
    const row = poseTraceRow({ at: 1000, pose: null, signals: readGestures(null, null, 1000, gestureConfig()) }, sample({ lost: true }), { t0: 1000 });
    expect(col(row, 'k11x')).toBeNull();
    expect(col(row, 'lost')).toBe(1);
    expect(col(row, 'wiper')).toBeNull();
  });
  it('carries push strokes, hops and the practice target', () => {
    const row = poseTraceRow(frameOf(pose(0)), sample(), { t0: 1000, pushStroke: true, hop: -1, target: 3 });
    expect([col(row, 'pushStroke'), col(row, 'hop'), col(row, 'target')]).toEqual([1, -1, 3]);
  });
});

describe('trace recorder: pose batches', () => {
  it('records nothing until it is begun', () => {
    const { recorder, sent } = setup();
    recorder.pose(frameOf(pose()), sample());
    recorder.flush('x');
    expect(sent).toEqual([]);
    expect(recorder.stats().recording).toBe(false);
  });
  it('downsamples to ten rows a second however often it is offered a frame', () => {
    const { recorder, tick } = setup();
    recorder.begin(HEADER);
    for (let i = 0; i < 180; i += 1) { recorder.pose(frameOf(pose(), 1000 + i * 16), sample()); tick(16); }   // 60 Hz for 2.9 s
    expect(recorder.stats().poseRows).toBeGreaterThanOrEqual(28);
    expect(recorder.stats().poseRows).toBeLessThanOrEqual(30);
  });
  it('sends one batch every 20 s with one header: run, level, shooter, gesture, t0 and the column names', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    for (let i = 0; i < 450; i += 1) { recorder.pose(frameOf(pose(), 5000 + i * 100), sample()); tick(100); }   // 45 s
    const batches = of('skyline_invaders.pose.trace');
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({
      kind: 'round', runId: 'run-1', levelId: 'invaders-1-1', shooterId: 'kid', gesture: 'wiper', gestureKind: 'aim',
      seq: 0, t0: 5000, hz: 10, n: 200, cols: POSE_TRACE_COLS, reason: 'interval',
    });
    expect(batches[0].rows).toHaveLength(200);
    expect(batches[1]).toMatchObject({ seq: 1, n: 200, t0: 25000 });
    expect(batches[1].rows[0][0]).toBe(0);                      // dt restarts with each batch
  });
  it('stays under three pose events a minute, and a batch stays small enough to ship', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    for (let i = 0; i < 1800; i += 1) { recorder.pose(frameOf(pose(i % 40), i * 100), sample()); tick(100); }   // a 180 s round
    recorder.end('round-end');
    const batches = of('skyline_invaders.pose.trace');
    expect(batches).toHaveLength(9);
    for (const batch of batches) expect(JSON.stringify(batch).length).toBeLessThan(100_000);
  });
  it('flushes what it has on end, and stops', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    for (let i = 0; i < 12; i += 1) { recorder.pose(frameOf(pose(), 1000 + i * 100), sample()); tick(100); }
    recorder.end('exit');
    expect(of('skyline_invaders.pose.trace')).toEqual([expect.objectContaining({ n: 12, reason: 'exit' })]);
    recorder.pose(frameOf(pose(), 9000), sample());
    recorder.end('again');
    expect(of('skyline_invaders.pose.trace')).toHaveLength(1);
  });
  it('a new begin sends the old buffer under the old header first', () => {
    const { recorder, tick, of } = setup();
    recorder.begin({ ...HEADER, kind: 'tryout', gesture: 'twist' });
    recorder.pose(frameOf(pose(), 1000), sample()); tick(100);
    recorder.begin({ ...HEADER, kind: 'tryout', gesture: 'push' });
    recorder.pose(frameOf(pose(), 2000), sample()); tick(100);
    recorder.end();
    expect(of('skyline_invaders.pose.trace').map((batch) => [batch.gesture, batch.gestureKind, batch.seq])).toEqual([['twist', 'aim', 0], ['push', 'impulse', 0]]);
  });
  it('keeps a push stroke or a hop that happened between rows for the next row', () => {
    const { recorder, tick, of } = setup();
    recorder.begin({ ...HEADER, gesture: 'hop' });
    const plain = frameOf(pose(), 1000);
    recorder.pose(plain, sample()); tick(30);
    const hopped = { ...frameOf(pose(), 1030), signals: { ...plain.signals, hop: { hop: 1 }, push: { ...plain.signals.push, started: true } } };
    recorder.pose(hopped, sample()); tick(30);            // too soon for a row
    recorder.pose(frameOf(pose(), 1060), sample()); tick(50);
    recorder.pose(frameOf(pose(), 1110), sample());       // the next row
    recorder.end();
    const rows = of('skyline_invaders.pose.trace')[0].rows;
    expect(rows.map((row) => [col(row, 'hop'), col(row, 'pushStroke')])).toEqual([[0, 0], [1, 1]]);
  });
});

describe('trace recorder: shot batches', () => {
  const fired = (volley, over = {}) => ({ volley, tier: 'double', lane: 3, x: 445, target: { id: 9, type: 'meteor', x: 555, y: 210.4, miss: 110 }, ...over });
  it('writes one row per volley once it settles: time, lane, aim, nearest threat, signed miss, hit', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    recorder.volleyFired(fired(1), sample({ raw: 0.4372 })); tick(250);
    recorder.volleyFired(fired(2, { lane: 4, x: 555, target: { x: 555, y: 300, miss: 0 } }), sample({ raw: 0.56 })); tick(300);
    recorder.volleySettled(1, false);
    recorder.volleySettled(2, true);
    recorder.end('round-end');
    const [batch] = of('skyline_invaders.shot.trace');
    expect(batch).toMatchObject({ kind: 'round', runId: 'run-1', gesture: 'wiper', cols: SHOT_TRACE_COLS, n: 2, reason: 'round-end' });
    expect(batch.rows).toEqual([[0, 3, 437, 445, 555, 210, 110, 0, 1], [250, 4, 560, 555, 555, 300, 0, 1, 1]]);
    expect(shotCol(batch.rows[0], 'miss')).toBe(110);
  });
  it('writes nulls for an empty sky, and a null hit for a volley still in the air at the end', () => {
    const { recorder, of } = setup();
    recorder.begin(HEADER);
    recorder.volleyFired(fired(1, { target: null, tier: 'small' }), sample());
    recorder.end('exit');
    expect(of('skyline_invaders.shot.trace')[0].rows).toEqual([[0, 3, 700, 445, null, null, null, null, 0]]);
  });
  it('keeps a volley in the air across an interval flush instead of sending it unsettled', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    recorder.volleyFired(fired(1), sample()); tick(100);
    recorder.volleySettled(1, true);
    tick(20_000);
    recorder.volleyFired(fired(2), sample());             // opens the next batch and flushes the first
    expect(of('skyline_invaders.shot.trace')).toEqual([expect.objectContaining({ n: 1, reason: 'interval' })]);
    recorder.volleySettled(2, true);
    recorder.end();
    expect(of('skyline_invaders.shot.trace')[1]).toMatchObject({ n: 1, seq: 1 });
  });
  it('ignores a settle for a volley it never saw', () => {
    const { recorder, sent } = setup();
    recorder.begin(HEADER);
    recorder.volleySettled(99, true);
    recorder.end();
    expect(sent).toEqual([]);
  });
  it('a stream at four volleys a second fits a batch', () => {
    const { recorder, tick, of } = setup();
    recorder.begin(HEADER);
    for (let i = 0; i < 80; i += 1) { recorder.volleyFired(fired(i), sample()); recorder.volleySettled(i, i % 3 === 0); tick(250); }
    recorder.end();
    const batches = of('skyline_invaders.shot.trace');
    expect(batches.reduce((sum, batch) => sum + batch.n, 0)).toBe(80);
    for (const batch of batches) expect(JSON.stringify(batch).length).toBeLessThan(20_000);
  });
});
