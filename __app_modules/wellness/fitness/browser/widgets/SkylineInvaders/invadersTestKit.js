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

// 33 BlazePose keypoints. Shoulders 120 px apart around x 320; both wrists sit
// `wristDx` px from their own shoulder (negative = image-left = screen right).
export function pose(wristDx = 0, { score = 0.9, wristY = 200 } = {}) {
  const keypoints = Array.from({ length: 33 }, () => ({ x: 0, y: 0, score: 0 }));
  keypoints[KP.nose] = { x: 320, y: 120, score };
  keypoints[KP.leftShoulder] = { x: 380, y: 200, score };
  keypoints[KP.rightShoulder] = { x: 260, y: 200, score };
  keypoints[KP.leftWrist] = { x: 380 + wristDx, y: wristY, score };
  keypoints[KP.rightWrist] = { x: 260 + wristDx, y: wristY, score };
  return { keypoints };
}
export const TEST_CALIBRATION = Object.freeze({ left: -1, right: 1 });
/** The pose whose hands point at `aim` (0..1) under TEST_CALIBRATION. */
export const poseForAim = (aim) => pose(-(2 * aim - 1) * 120);

/** A trusted heart-rate zone profile, fresh whenever it is read. */
export const zoneProfile = (zoneId, over = {}) => ({ zoneTrusted: true, zoneReadingEligible: true, zoneReadingAt: Date.now(), currentZoneId: zoneId, ...over });

export function makeCtx({ matRider = 'kid', profile = () => zoneProfile('cool') } = {}) {
  const listeners = new Map();
  const riders = { 'step-mat': matRider };
  const state = { profile, cadence: { rpm: 0, connected: false } };
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
      zoneProfileStore: { getProfile: (id) => state.profile(id) },
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
export function routeFetch({ levels = [testLevel()], world = null } = {}) {
  const routes = {
    levels: vi.fn(async () => json({ levels })),
    world: vi.fn(async () => (world ? json(world) : json({ error: 'unavailable' }, false, 503))),
    runs: vi.fn(async () => json({ created: true }, true, 201)),
    unlock: vi.fn(async () => json({ progress: {} })),
    sounds: vi.fn(async () => json({}, false, 404)),
  };
  global.fetch = vi.fn((url, options) => {
    const path = String(url);
    if (path.includes('/skyline-invaders/levels')) return routes.levels(url, options);
    if (path.includes('/skyline-invaders/world')) return routes.world(url, options);
    if (path.includes('/skyline-invaders/runs')) return routes.runs(url, options);
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
