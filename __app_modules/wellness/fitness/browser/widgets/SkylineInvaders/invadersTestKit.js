// Shared scaffolding for the Skyline Invaders shell suites. The vi.mock calls
// stay in each test file (they are hoisted); everything else lives here.
// Placeholder ids only: `kid`, `test-rider`.
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import { KP } from '../../lib/skylineInvaders/aim.js';

export const testLevel = (over = {}) => ({
  schema: 'skyline-invaders-level/v1', id: 'invaders-test', name: 'Test Wave', duration_s: 30,
  pass: { kills: 1 }, waves: [{ at: 0, rate_s: 2, spawn: { meteor: 1 } }], ...over,
});

// 33 BlazePose keypoints, camera image, y down, not flipped (the player's left
// is at larger x). Shoulders 120 px apart around x 320, elbows hanging below
// them, forearms 80 px long.
const SHOULDER_Y = 200;
const ELBOW_Y = 300;
const FOREARM = 80;
function body(score = 0.9) {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  keypoints[KP.nose] = { x: 320, y: 120, score };
  keypoints[KP.leftShoulder] = { x: 380, y: SHOULDER_Y, score };
  keypoints[KP.rightShoulder] = { x: 260, y: SHOULDER_Y, score };
  keypoints[KP.leftElbow] = { x: 390, y: ELBOW_Y, score };
  keypoints[KP.rightElbow] = { x: 250, y: ELBOW_Y, score };
  keypoints[KP.leftHip] = { x: 350, y: 420, score };
  keypoints[KP.rightHip] = { x: 290, y: 420, score };
  return keypoints;
}
/**
 * A wiper pose: both forearms tilted `deg` from upright (+ = toward screen
 * right, which is image-left). 50 degrees is the screen edge.
 */
export function wiperPose(deg = 0, { score = 0.9 } = {}) {
  const keypoints = body(score);
  const rad = (deg * Math.PI) / 180;
  const tip = (elbow) => ({ x: elbow.x - FOREARM * Math.sin(rad), y: elbow.y - FOREARM * Math.cos(rad), score });
  keypoints[KP.leftWrist] = tip(keypoints[KP.leftElbow]);
  keypoints[KP.rightWrist] = tip(keypoints[KP.rightElbow]);
  return { keypoints };
}
/** The wiper pose that aims at `aim` (0..1). */
export const poseForAim = (aim) => wiperPose((aim - 0.5) * 2 * 50);
/** The wiper pose that puts the cannon on `lane` (0..7). */
export const poseForLane = (lane) => poseForAim((lane + 0.5) / 8);
/**
 * Both wrists placed directly: `out` shoulder widths from the midline (+ =
 * screen right), `drop` shoulder widths below the shoulders. A pair gives each
 * wrist its own offset: [player's left wrist, player's right wrist].
 */
export function handsPose(out = 0, { drop = 0, score = 0.9 } = {}) {
  const keypoints = body(score);
  const [left, right] = Array.isArray(out) ? out : [out, out];
  const drops = Array.isArray(drop) ? drop : [drop, drop];
  keypoints[KP.leftWrist] = { x: 320 - left * 120, y: SHOULDER_Y + drops[0] * 120, score };
  keypoints[KP.rightWrist] = { x: 320 - right * 120, y: SHOULDER_Y + drops[1] * 120, score };
  return { keypoints };
}
/** Head and shoulders in view, no usable arm. */
export const standingPose = () => ({ keypoints: body().map((kp, index) => ([KP.leftWrist, KP.rightWrist, KP.leftElbow, KP.rightElbow].includes(index) ? { x: 0, y: 0, score: 0 } : kp)) });

export function makeCtx({ matRider = 'kid' } = {}) {
  const listeners = new Map();
  const riders = { 'step-mat': matRider };
  const state = { cadence: { rpm: 0, connected: false } };
  return {
    state, riders,
    equipment: [{ id: 'step-mat', type: 'pressure_mat', pressure_mat: 'mat-a1' }, { id: 'bike', cadence: 7 }],
    users: [{ id: 'kid', name: 'Kid' }, { id: 'test-rider', name: 'Test Rider' }],
    participantRoster: [],
    fitnessSessionInstance: {
      sessionId: 'fs-test',
      treasureBox: { awardBonus: vi.fn() },
      getEquipmentRider: (id) => riders[id] || null,
      setEquipmentUser: vi.fn((id, userId) => { riders[id] = userId; }),
      getEquipmentCadence: () => state.cadence,
    },
    getUserByName: (id) => ({ id, schoolLearner: true }),
    subscribeToAppEvent: (type, callback) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
      return () => listeners.get(type)?.delete(callback);
    },
    __emitAppEvent: (type, payload) => listeners.get(type)?.forEach((callback) => callback({ type, payload, source: payload?.id, timestamp: Date.now() })),
    setGovernanceSuspended: vi.fn(),
  };
}

const json = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

/** global.fetch routed by URL. Each route is a vi.fn that tests may re-point. */
export function routeFetch({ levels = [testLevel()], world = null, controls = null } = {}) {
  const routes = {
    levels: vi.fn(async () => json({ levels })),
    // `controls` alone is a rider with saved controls and every level open.
    world: vi.fn(async () => (world || controls
      ? json(world || { levels: levels.map((level) => ({ id: level.id, name: level.name, status: 'open' })), next: levels[0]?.id || null, controls })
      : json({ error: 'unavailable' }, false, 503))),
    controls: vi.fn(async (url, options) => json({ controls: JSON.parse(options.body) })),
    runs: vi.fn(async () => json({ created: true }, true, 201)),
    unlock: vi.fn(async () => json({ progress: {} })),
    sounds: vi.fn(async () => json({}, false, 404)),
  };
  global.fetch = vi.fn((url, options) => {
    const path = String(url);
    if (path.includes('/skyline-invaders/levels')) return routes.levels(url, options);
    if (path.includes('/skyline-invaders/world')) return routes.world(url, options);
    if (path.includes('/skyline-invaders/runs')) return routes.runs(url, options);
    if (path.includes('/skyline-invaders/progress/') && path.endsWith('/controls')) return routes.controls(url, options);
    if (path.includes('/skyline-invaders/progress/')) return routes.unlock(url, options);
    return routes.sounds(url, options);
  });
  return routes;
}
export const postedRecords = (routes) => routes.runs.mock.calls.filter(([, options]) => options?.method === 'POST').map(([, options]) => JSON.parse(options.body).record);

/**
 * Fake timers plus a hand-cranked requestAnimationFrame. `frames(n, ms)` moves
 * the clock `ms` per frame (timers, Date and performance together) and runs
 * every callback that was waiting, the way a browser would.
 */
export function installFrames() {
  // requestAnimationFrame is left out of the fake timers: it is cranked by hand below.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  let queue = [];
  let nextId = 1;
  globalThis.requestAnimationFrame = (callback) => { const id = nextId++; queue.push({ id, callback }); return id; };
  globalThis.cancelAnimationFrame = (id) => { queue = queue.filter((item) => item.id !== id); };
  const frames = async (count = 1, ms = 100) => {
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        vi.advanceTimersByTime(ms);
        const due = queue;
        queue = [];
        const at = performance.now();
        due.forEach((item) => item.callback(at));
      });
    }
  };
  return { frames, seconds: (s, ms = 100) => frames(Math.round((s * 1000) / ms), ms) };
}
export const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
