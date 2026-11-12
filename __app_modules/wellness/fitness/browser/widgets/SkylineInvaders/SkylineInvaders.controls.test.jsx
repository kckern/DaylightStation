// Whole rounds played through the real shell, engine, hooks, scene and HUD,
// with only the edges faked: app events for the mat, a pose stream through the
// bridge, a zone profile, a bike. No assertion here is conditional: a
// precondition that fails (no meteor on screen, say) fails the test by name.
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ctx: null, bridge: null, lifecycle: null, audio: null,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
}));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => h.ctx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('@/lib/kioskEnv.js', () => ({ isLocalDevHost: () => true, isKioskEnv: () => false }));
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn(async () => ({ items: [] })), DaylightMediaPath: (path) => path, DaylightImagePath: (path) => path }));
vi.mock('../../identity/useIdentity.js', () => ({
  useIdentity: () => ({ registerAdmin: vi.fn(async () => ({ matched: false })), clearUnlock: vi.fn(), unlockState: 'idle', unlockedUser: null }),
}));
vi.mock('../../player/useFitnessModule.js', () => {
  const useFitnessModule = () => ({ registerLifecycle: (callbacks) => { h.lifecycle = callbacks; } });
  return { default: useFitnessModule, useFitnessModule };
});
vi.mock('../../context/PoseContext.jsx', () => ({ PoseProvider: ({ children }) => children, default: {} }));
vi.mock('./InvadersPoseBridge.jsx', () => ({ default: (props) => { h.bridge = props; return null; } }));
vi.mock('../../lib/skylineGlider/skylineAudio.js', () => ({ createSkylineAudio: () => h.audio }));
vi.mock('../../lib/useGamepadKeys.js', () => ({ useGamepadKeys: () => {} }));

import SkylineInvaders from './SkylineInvaders.jsx';
import { aimToX, xToAim } from '../../lib/skylineInvaders/threats.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { TEST_CALIBRATION, flush, installFrames, makeCtx, pose, poseForAim, postedRecords, routeFetch, testLevel, zoneProfile } from './invadersTestKit.js';

let routes;
let f;
const press = (name) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
const keyDown = (key) => act(async () => { fireEvent.keyDown(window, { key }); });
const keyUp = (key) => act(async () => { fireEvent.keyUp(window, { key }); });
const step = (id = 'mat-a1', type = 'pressure-mat:step') => act(async () => { h.ctx.__emitAppEvent(type, { id }); });
const feed = (p) => act(async () => { h.bridge.tracker.processPoses(p ? [p] : []); });
const hold = async (p, ms) => { for (let t = 0; t < ms; t += 100) { await feed(p); await f.frames(1); } };
const status = (state) => act(async () => { h.bridge.onStatus({ state, fps: 13, latency: 70, backend: 'wasm', modelType: 'full', error: null }); });
const hud = () => screen.getByTestId('skyline-invaders-hud').textContent;
const kills = () => screen.getByTestId('invaders-kills').textContent;
const cannonX = () => Number(document.querySelector('[data-cannon]').getAttribute('data-x'));
const shots = (tier) => document.querySelectorAll(tier ? `[data-shot="${tier}"]` : '[data-shot]');
const fired = () => h.log.sampled.mock.calls.filter(([name]) => name === 'skyline_invaders.fire').map(([, data]) => data);
const firstMeteor = () => {
  const meteor = document.querySelector('[data-threat="meteor"]');
  expect(meteor, 'a meteor should be on screen').not.toBeNull();
  return { x: Number(meteor.getAttribute('data-x')), y: Number(meteor.getAttribute('data-y')) };
};

async function mount(options = {}) {
  f = installFrames();
  routes = routeFetch(options);
  render(<SkylineInvaders />);
  await flush();
}
async function start(name = /^Start/) {
  await press(name);
  await f.seconds(3.1);
  expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('playing');
}
// Calibration without the lobby flow, for the cases that are not about it.
const calibrate = () => act(async () => { h.bridge.tracker.setCalibration(TEST_CALIBRATION); });
async function pointAtFirstMeteor() {
  await f.frames(2);
  const meteor = firstMeteor();
  await hold(poseForAim(xToAim(meteor.x)), 600);
  return meteor;
}

beforeEach(() => {
  Object.values(h.log).forEach((fn) => fn.mockClear());
  h.ctx = makeCtx();
  h.bridge = null;
  h.audio = { loadSounds: vi.fn(async () => ({ loaded: [], missing: [] })), prime: vi.fn(async () => true), playCue: vi.fn(() => true), setMuted: vi.fn(), stop: vi.fn() };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Skyline Invaders controls', () => {
  it('solo core loop: calibrate in the lobby, start, point, step, and the kill counts', async () => {
    await mount();
    await status('detecting');
    await press(/Calibrate/);
    await hold(pose(0, { wristY: 900 }), 1300);   // standing in view, hands hanging out of frame
    await hold(pose(120), 1100);                  // far left
    await hold(pose(-120), 1100);                 // far right
    expect(screen.getByTestId('skyline-invaders-lobby')).toBeTruthy();
    await feed(pose(0));
    await start();
    await pointAtFirstMeteor();
    await step();
    await f.seconds(1);
    expect(kills()).toBe('1 ✓');
    expect(fired()[0]).toMatchObject({ source: 'mat', tier: 'small' });
  });

  it('aim latch: a shot uses the aim from before the step, not the lurch that comes with it', async () => {
    await mount();
    await calibrate();
    await start();
    await hold(poseForAim(0.25), 700);
    await f.frames(2);                 // 200 ms with no new pose, then...
    await feed(poseForAim(0.9));       // ...the arms fly as the foot comes down
    await step();
    await f.frames(1);
    expect(fired()).toHaveLength(1);
    expect(fired()[0].aim).toBeCloseTo(0.25, 1);
    expect(Math.abs(fired()[0].aim - 0.9)).toBeGreaterThan(0.4);
  });

  it('mirroring: hands moved toward image-left move the cannon right', async () => {
    await mount();
    await calibrate();
    await start();
    await hold(pose(0), 500);
    const centre = cannonX();
    await hold(pose(-60), 500);
    expect(cannonX()).toBeGreaterThan(centre + 100);
    expect(centre).toBeCloseTo(aimToX(0.5), 0);
  });

  it('mat filter: another mat and a stomp on the shooter\'s mat fire nothing', async () => {
    h.ctx.equipment.push({ id: 'spare-mat', type: 'pressure_mat', pressure_mat: 'mat-b2' });
    await mount();
    await start();
    await step('mat-b2');
    await step('mat-a1', 'pressure-mat:stomp');
    await f.frames(2);
    expect(shots()).toHaveLength(0);
    await step('mat-a1');
    await f.frames(1);
    expect(shots()).toHaveLength(1);
  });

  describe('tiers follow the shooter\'s heart-rate zone', () => {
    const fireOnce = async (zone, over) => {
      h.ctx = makeCtx({ profile: () => zoneProfile(zone, over) });
      await mount();
      await start();
      await f.frames(1);
      await step();
      await f.frames(1);
    };
    it('warm fires one big shot', async () => {
      await fireOnce('warm');
      expect(shots('big')).toHaveLength(1);
      expect(screen.getByTestId('invaders-tier').getAttribute('data-tier')).toBe('big');
    });
    it('hot fires a spread of three', async () => {
      await fireOnce('hot');
      expect(shots('spread')).toHaveLength(3);
    });
    it('fire launches a nuke that blasts where it meets a threat', async () => {
      h.ctx = makeCtx({ profile: () => zoneProfile('fire') });
      await mount();
      await calibrate();
      await start();
      await pointAtFirstMeteor();
      await step();
      await f.frames(1);
      expect(shots('nuke')).toHaveLength(1);
      let blasts = 0;
      for (let i = 0; i < 10 && !blasts; i += 1) { await f.frames(1); blasts = document.querySelectorAll('[data-blast]').length; }
      expect(blasts).toBe(1);
      expect(kills()).toBe('1 ✓');
    });
    it('an untrusted heart rate fires small shots and says why', async () => {
      await fireOnce('fire', { zoneTrusted: false });
      expect(shots('small')).toHaveLength(1);
      expect(hud()).toContain('No trusted heart rate — small shots');
    });
  });

  it('co-op: the mat fires for the shooter whoever stands on it, at the shooter\'s tier', async () => {
    h.ctx = makeCtx({ matRider: null, profile: (id) => zoneProfile(id === 'kid' ? 'warm' : 'fire') });
    await mount();
    await press('Kid');
    await start();
    await f.frames(1);
    await step();
    await f.frames(1);
    expect(shots('big')).toHaveLength(1);
    expect(shots('nuke')).toHaveLength(0);
    expect(hud()).toContain('Kid');
  });

  it('partner boost: a rider at full cadence fills the meter and rapid fire shoots by itself', async () => {
    h.ctx.riders.bike = 'test-rider';
    h.ctx.state.cadence = { rpm: 100, connected: true };
    await mount({ levels: [testLevel({ boost: { fill_s: 2, duration_s: 4, rotation: ['rapid'] } })] });
    await start();
    expect(screen.getByTestId('invaders-boost').getAttribute('data-boost')).toBe('filling');
    await f.seconds(2.3);
    expect(screen.getByTestId('invaders-boost').getAttribute('data-boost')).toBe('rapid');
    expect(screen.getByTestId('invaders-boost').textContent).toContain('Rapid fire');
    await f.frames(3);
    expect(shots().length).toBeGreaterThan(0);
    expect(fired().every((shot) => shot.source === 'auto')).toBe(true);
    expect(h.log.sampled.mock.calls.filter(([name]) => name === 'skyline_invaders.round.boost.activated')).toHaveLength(1);
  });

  it('no partner on a bike: no boost meter', async () => {
    await mount();
    await start();
    await f.seconds(1);
    expect(screen.queryByTestId('invaders-boost')).toBeNull();
  });

  it('pose lost: the HUD asks the shooter back, the clock keeps running, and the cannon drifts to the lowest threat', async () => {
    await mount();
    await calibrate();
    await start();
    await f.frames(2);
    const meteor = firstMeteor();
    const away = meteor.x > 500 ? 0.1 : 0.9;
    await hold(poseForAim(away), 500);
    expect(hud()).not.toContain('Step into view');
    const before = { x: cannonX(), time: screen.getByTestId('invaders-time').textContent };
    await f.seconds((INVADERS_TUNABLES.poseLostAfterMs + 200) / 1000);
    expect(hud()).toContain('Step into view');
    await f.seconds(2);
    expect(screen.getByTestId('invaders-time').textContent).not.toBe(before.time);
    expect(Math.abs(cannonX() - meteor.x)).toBeLessThan(Math.abs(before.x - meteor.x) - 50);
  });

  it('keyboard round: no camera and no mat, Space fires, the arrows aim, and the round is saved with its stars', async () => {
    h.ctx = makeCtx({ matRider: null });
    h.ctx.equipment = h.ctx.equipment.filter((item) => item.id !== 'step-mat');
    await mount();
    await status('camera-denied');
    expect(screen.getByText(/No step mat found/)).toBeTruthy();
    await press('Kid');
    await start();
    await f.frames(2);
    const meteor = firstMeteor();
    const arrow = meteor.x > cannonX() ? 'ArrowRight' : 'ArrowLeft';
    await keyDown(arrow);
    let frames = 0;
    while (Math.abs(cannonX() - meteor.x) > 12 && frames < 60) { await f.frames(1, 16); frames += 1; }
    await keyUp(arrow);
    expect(Math.abs(cannonX() - meteor.x)).toBeLessThanOrEqual(12);
    await keyDown(' ');
    await f.seconds(1);
    expect(kills()).toBe('1 ✓');
    expect(fired()[0]).toMatchObject({ source: 'keyboard' });
    await f.seconds(30);
    await flush();
    const result = screen.getByTestId('skyline-invaders-result');
    expect(result.getAttribute('data-status')).toBe('completed');
    expect(result.getAttribute('data-save')).toBe('saved');
    const [record] = postedRecords(routes);
    expect(record.run).toMatchObject({ status: 'completed', kills: 1 });
    expect(record.run.mat_equipment_id).toBeUndefined();
    expect(record.run.stars).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(`${record.run.stars} of 3 stars`)).toBeTruthy();
  });
});
