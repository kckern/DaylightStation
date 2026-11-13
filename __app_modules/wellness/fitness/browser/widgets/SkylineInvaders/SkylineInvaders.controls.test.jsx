// Whole rounds played through the real shell, engine, hooks, scene and HUD,
// with only the edges faked: app events for the mat, a pose stream through the
// bridge, a bike. No assertion here is conditional: a
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
import { laneX } from '../../lib/skylineInvaders/lanes.js';
import { xToAim } from '../../lib/skylineInvaders/threats.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { flush, installFrames, makeCtx, poseForAim, poseForLane, postedRecords, routeFetch, standingPose, testLevel, wiperPose } from './invadersTestKit.js';

let routes;
let f;
const press = (name) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
const keyDown = (key) => act(async () => { fireEvent.keyDown(window, { key }); });
const keyUp = (key) => act(async () => { fireEvent.keyUp(window, { key }); });
const step = (id = 'mat-a1', type = 'pressure-mat:step') => act(async () => { h.ctx.__emitAppEvent(type, { id }); });
const stomp = (id = 'mat-a1') => step(id, 'pressure-mat:stomp');
const feed = (p) => act(async () => { h.bridge.tracker.processPoses(p ? [p] : []); });
const hold = async (p, ms) => { for (let t = 0; t < ms; t += 100) { await feed(p); await f.frames(1); } };
const status = (state) => act(async () => { h.bridge.onStatus({ state, fps: 13, latency: 70, backend: 'wasm', modelType: 'full', error: null }); });
const phase = () => document.querySelector('.skyline-invaders').getAttribute('data-phase');
const hud = () => screen.getByTestId('skyline-invaders-hud').textContent;
const kills = () => screen.getByTestId('invaders-kills').textContent;
const cannon = () => document.querySelector('[data-cannon]');
const cannonX = () => Number(cannon().getAttribute('data-x'));
const cannonLane = () => Number(cannon().getAttribute('data-lane'));
const shots = (tier) => [...document.querySelectorAll(tier ? `[data-shot="${tier}"]` : '[data-shot]')];
const logged = (name) => [...h.log.info.mock.calls, ...h.log.sampled.mock.calls, ...h.log.warn.mock.calls, ...h.log.error.mock.calls].filter(([event]) => event === name).map(([, data]) => data);
const fuelPct = () => parseFloat(screen.getByTestId('invaders-fuel').querySelector('.game-hud-progress span').style.width);
const firstMeteor = () => {
  const meteor = document.querySelector('[data-threat="meteor"]');
  expect(meteor, 'a meteor should be on screen').not.toBeNull();
  return { x: Number(meteor.getAttribute('data-x')), y: Number(meteor.getAttribute('data-y')) };
};

// A rider who already has controls, unless the test is about picking them.
async function mount({ onClose, ...options } = {}) {
  f = installFrames();
  routes = routeFetch({ controls: { gesture: 'wiper' }, ...options });
  render(<SkylineInvaders onClose={onClose} />);
  await flush();
}
async function start(name = /^Start/) {
  await press(name);
  await f.seconds(3.1);
  expect(phase()).toBe('playing');
}
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
  it('first time: pick controls in the intro, start, point, step, and the kill counts', async () => {
    await mount({ controls: null });
    await status('detecting');
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    await press(/Pick your controls/);
    expect(phase()).toBe('controls');
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Wipers');
    // The tryout: the real cannon follows the wiper gesture and lights the left target.
    await hold(wiperPose(0), 300);
    await hold(poseForLane(0), 1500);
    expect(cannonLane()).toBe(0);
    expect(document.querySelector('[data-practice-target="left"]').getAttribute('data-reached')).toBe('true');
    await stomp();                                   // stomp = pick this one
    await flush();
    expect(phase()).toBe('lobby');
    expect(routes.controls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(routes.controls.mock.calls[0][1].body)).toEqual({ gesture: 'wiper' });
    expect(logged('skyline_invaders.controls.chosen')[0]).toMatchObject({ shooterId: 'kid', gesture: 'wiper', how: 'stomp', previous: null, saved: true });
    expect(logged('skyline_invaders.controls.tryout')[0]).toMatchObject({ shooterId: 'kid', gesture: 'wiper', how: 'chosen-stomp', reached: 1, leftMs: expect.any(Number), rightMs: null });
    await start();
    await pointAtFirstMeteor();
    await step();
    await f.seconds(1.2);
    expect(kills()).toMatch(/^[1-9] ✓$/);
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ gesture: 'wiper', gestureChosen: true, aimMode: 'pose' });
  });

  it('the intro walks the cards with mat steps and saves the one that is stomped on', async () => {
    await mount({ controls: null });
    await status('detecting');
    await press(/Pick your controls/);
    await step();
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Twist');
    await step();
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Wings');
    expect(h.bridge.tracker.gesture()).toBe('wings');
    await step('mat-b2');                            // someone else's mat
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Wings');
    await press(/^Back/);
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Twist');
    await stomp();
    await flush();
    expect(JSON.parse(routes.controls.mock.calls[0][1].body)).toEqual({ gesture: 'twist' });
    expect(screen.getByTestId('invaders-controls-chosen').textContent).toBe('ControlsTwist');
    expect(h.bridge.tracker.gesture()).toBe('twist');
    expect(logged('skyline_invaders.controls.tryout').map((entry) => [entry.gesture, entry.how])).toEqual([['wiper', 'step'], ['twist', 'step'], ['wings', 'button'], ['twist', 'chosen-stomp']]);
  });

  it('a card moves on by itself, and a choice that cannot be saved still holds for the session', async () => {
    await mount({ controls: null });
    routes.controls.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await status('detecting');
    await press(/Pick your controls/);
    await f.seconds(INVADERS_TUNABLES.tryoutCardS + 0.3);
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Twist');
    expect(logged('skyline_invaders.controls.tryout')[0]).toMatchObject({ gesture: 'wiper', how: 'timeout', reached: 0 });
    await press(/Use these controls/);
    await flush();
    expect(logged('skyline_invaders.controls.save_error')).toHaveLength(1);
    expect(logged('skyline_invaders.controls.chosen')[0]).toMatchObject({ gesture: 'twist', how: 'button', saved: false });
    expect(screen.getByRole('button', { name: /^Start/ })).toBeTruthy();
  });

  it('a rider with saved controls goes straight to Start, and can change them without losing them by backing out', async () => {
    await mount({ controls: { gesture: 'sprinkler' } });
    await status('detecting');
    expect(screen.getByTestId('invaders-controls-chosen').textContent).toBe('ControlsSprinkler');
    expect(h.bridge.tracker.gesture()).toBe('sprinkler');
    await press(/Change controls/);
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Sprinkler');   // opens on their own
    await step();
    expect(h.bridge.tracker.gesture()).toBe('drag');
    await press(/Keep Sprinkler/);
    expect(phase()).toBe('lobby');
    expect(h.bridge.tracker.gesture()).toBe('sprinkler');
    expect(routes.controls).not.toHaveBeenCalled();
    await start();
    await hold(standingPose(), 300);
    expect(screen.getByTestId('invaders-controls').textContent).toBe('Aim: Sprinkler');
  });

  it('lanes: the cannon stands on a lane centre and a shot leaves from where it is drawn', async () => {
    await mount();
    await start();
    await hold(poseForLane(2), 700);
    expect(cannonX()).toBeCloseTo(laneX(2));
    expect(document.querySelector('[data-column]').getAttribute('data-lane')).toBe('2');
    await step();
    await f.frames(1);
    expect(shots()).toHaveLength(1);
    expect(Number(shots()[0].getAttribute('x')) + Number(shots()[0].getAttribute('width')) / 2).toBeCloseTo(cannonX());
    // The aim moves on; the stream follows the cannon, with no latch to an older aim.
    await hold(poseForLane(6), 700);
    expect(cannonX()).toBeCloseTo(laneX(6));
    const newest = shots().sort((a, b) => Number(b.getAttribute('y')) - Number(a.getAttribute('y')))[0];
    expect(Number(newest.getAttribute('x')) + Number(newest.getAttribute('width')) / 2).toBeCloseTo(laneX(6));
  });

  it('mirroring: forearms tilted toward image-left move the cannon right', async () => {
    await mount();
    await start();
    await hold(wiperPose(0), 500);
    const centre = cannonX();
    await hold(wiperPose(30), 500);
    expect(cannonX()).toBeGreaterThan(centre + 100);
  });

  it('the cannon marks the threat it will hit', async () => {
    await mount();
    await start();
    const meteor = await pointAtFirstMeteor();
    expect(cannonX()).toBeCloseTo(meteor.x);
    expect(document.querySelectorAll('[data-target]')).toHaveLength(1);
  });

  it('one step fuels a stream: it fires by itself for a second and a half, then asks for another step', async () => {
    await mount();
    await start();
    expect(screen.getByTestId('invaders-fuel').getAttribute('data-empty')).toBe('true');
    expect(screen.getByTestId('invaders-fuel').textContent).toContain('Step!');
    await step();
    await f.frames(1);
    expect(shots()).toHaveLength(1);
    expect(fuelPct()).toBeGreaterThan(25);
    await f.seconds(1);
    expect(shots().length).toBeGreaterThanOrEqual(2);       // more volleys, no more steps
    await f.seconds(2);
    expect(shots()).toHaveLength(0);
    expect(screen.getByTestId('invaders-fuel').getAttribute('data-empty')).toBe('true');
    expect(logged('skyline_invaders.fuel')).toEqual([expect.objectContaining({ source: 'mat', fuel: 1.5 })]);
  });

  it('spamming the mat only fills the tank', async () => {
    await mount();
    await start();
    for (let i = 0; i < 8; i += 1) await step();
    await f.frames(1);
    expect(fuelPct()).toBeGreaterThan(95);
    expect(shots()).toHaveLength(1);                          // eight steps, still one volley this beat
  });

  it('mat filter: another mat does nothing', async () => {
    h.ctx.equipment.push({ id: 'spare-mat', type: 'pressure_mat', pressure_mat: 'mat-b2' });
    await mount();
    await start();
    await step('mat-b2');
    await stomp('mat-b2');
    await f.frames(2);
    expect(shots()).toHaveLength(0);
    expect(fuelPct()).toBe(0);
  });

  it('power meter: firing and kills move the weapon up, announced on screen', async () => {
    await mount({ levels: [testLevel({ fire: { power_per_firing_s: 1.2 } })] });
    await start();
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-tier')).toBe('small');
    await step();
    await f.seconds(1.2);
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-tier')).toBe('double');
    expect(screen.getByText('Double shot!')).toBeTruthy();
    expect(shots('double').length).toBeGreaterThan(0);
    await step();
    await f.seconds(1);
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-tier')).toBe('spread');
    expect(logged('skyline_invaders.round.weapon.level').map((entry) => entry.tier)).toEqual(['double', 'spread']);
  });

  it('stomp bomb: a full meter at the top says STOMP, and a stomp blasts and spends it', async () => {
    await mount({ levels: [testLevel({ fire: { power_per_firing_s: 4 } })] });
    await start();
    await stomp();                                   // not ready yet: a stomp is a step
    await f.frames(1);
    expect(document.querySelectorAll('[data-blast]')).toHaveLength(0);
    expect(fuelPct()).toBeGreaterThan(25);
    await f.seconds(1);
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-bomb')).toBe('true');
    expect(screen.getByTestId('invaders-power').textContent).toContain('Stomp!');
    expect(screen.getByText('Bomb ready — STOMP!')).toBeTruthy();
    expect(cannon().getAttribute('data-tier')).toBe('bomb');
    await stomp();
    await f.frames(1);
    expect(document.querySelectorAll('[data-blast]')).toHaveLength(1);
    expect(screen.getByTestId('invaders-weapon').getAttribute('data-bomb')).toBe('false');
    expect(logged('skyline_invaders.round.bomb')).toHaveLength(1);
  });

  it('co-op: the mat fires for the shooter whoever stands on it', async () => {
    h.ctx = makeCtx({ matRider: null });
    await mount();
    await press('Kid');
    await flush();
    await start();
    await f.frames(1);
    await step();
    await f.frames(1);
    expect(shots()).toHaveLength(1);
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ shooterId: 'kid' });
  });

  it('partner boost: a rider at full cadence fills the meter and rapid fire shoots with an empty tank', async () => {
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
    expect(fuelPct()).toBe(0);
    expect(h.log.sampled.mock.calls.filter(([name]) => name === 'skyline_invaders.round.boost.activated')).toHaveLength(1);
  });

  it('no partner on a bike: no boost meter', async () => {
    await mount();
    await start();
    await f.seconds(1);
    expect(screen.queryByTestId('invaders-boost')).toBeNull();
  });

  it('arms that drop while stepping do not lose the player: the cannon holds its lane', async () => {
    await mount();
    await status('detecting');
    await start();
    await hold(poseForLane(6), 700);
    await hold(standingPose(), 3000);
    expect(cannonLane()).toBe(6);
    expect(hud()).not.toContain('Step into view');
    expect(logged('skyline_invaders.pose.lost')).toHaveLength(0);
  });

  it('pose lost: the HUD asks the shooter back, the clock keeps running, and the cannon drifts to the lowest threat', async () => {
    await mount();
    await status('detecting');
    await start();
    await f.frames(2);
    const meteor = firstMeteor();
    await hold(poseForLane(meteor.x > 500 ? 0 : 7), 500);
    expect(hud()).not.toContain('Step into view');
    const before = { x: cannonX(), time: screen.getByTestId('invaders-time').textContent };
    await f.seconds((INVADERS_TUNABLES.poseLostAfterMs + 200) / 1000);
    expect(hud()).toContain('Step into view');
    await f.seconds(3);
    expect(screen.getByTestId('invaders-time').textContent).not.toBe(before.time);
    expect(Math.abs(cannonX() - meteor.x)).toBeLessThan(Math.abs(before.x - meteor.x) - 50);
  });

  it('keyboard round: no camera and no mat, Space fuels the stream, the arrows move the cannon lane by lane, and the round is saved with its stars', async () => {
    h.ctx = makeCtx({ matRider: null });
    h.ctx.equipment = h.ctx.equipment.filter((item) => item.id !== 'step-mat');
    await mount({ controls: null });
    await status('camera-denied');
    expect(screen.getByText(/No step mat found/)).toBeTruthy();
    await press('Kid');
    await start();
    await f.frames(2);
    const meteor = firstMeteor();
    const arrow = meteor.x > cannonX() ? 'ArrowRight' : 'ArrowLeft';
    await keyDown(arrow);
    let frames = 0;
    while (cannonX() !== meteor.x && frames < 90) { await f.frames(1, 16); frames += 1; }
    await keyUp(arrow);
    expect(cannonX()).toBe(meteor.x);
    await keyDown(' ');
    await f.seconds(1.2);
    expect(kills()).toMatch(/^[1-9] ✓$/);
    expect(logged('skyline_invaders.fuel')[0]).toMatchObject({ source: 'keyboard' });
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ aimMode: 'manual', gestureChosen: false });
    await f.seconds(30);
    await flush();
    const result = screen.getByTestId('skyline-invaders-result');
    expect(result.getAttribute('data-status')).toBe('completed');
    expect(result.getAttribute('data-save')).toBe('saved');
    const [record] = postedRecords(routes);
    expect(record.run).toMatchObject({ status: 'completed', steps: 1, gesture: 'wiper' });
    expect(record.run.kills).toBeGreaterThanOrEqual(1);
    expect(record.run.shots_fired).toBeGreaterThanOrEqual(5);
    expect(record.run.mat_equipment_id).toBeUndefined();
    expect(record.run.stars).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(`${record.run.stars} of 3 stars`)).toBeTruthy();
    expect(logged('skyline_invaders.level.end')[0]).toMatchObject({ gesture: 'wiper', steps: 1, tally: expect.objectContaining({ keyboard: 1, stream: record.run.shots_fired }) });
  });
});

describe('Skyline Invaders joint recorder', () => {
  const traces = (name) => h.log.info.mock.calls.filter(([event]) => event === name).map(([, data]) => data);

  it('logs pose and shot traces for a round, with every gesture\'s signal, and flushes them when the round ends', async () => {
    await mount({ controls: { gesture: 'twist' } });
    await status('detecting');
    await start();
    await hold(wiperPose(20), 1000);
    await step();
    await hold(wiperPose(20), 3000);
    expect(traces('skyline_invaders.pose.trace')).toHaveLength(0);     // batched, not per frame
    await f.seconds(27);
    await flush();
    const pose = traces('skyline_invaders.pose.trace');
    const shot = traces('skyline_invaders.shot.trace');
    expect(pose.length).toBeGreaterThanOrEqual(1);
    expect(pose.length).toBeLessThanOrEqual(3);
    const { runId } = logged('skyline_invaders.level.start')[0];
    expect(pose[0]).toMatchObject({ kind: 'round', runId, levelId: 'invaders-test', shooterId: 'kid', gesture: 'twist', gestureKind: 'aim', hz: 10, seq: 0 });
    const cols = pose[0].cols;
    const first = pose[0].rows[0];
    expect(first).toHaveLength(cols.length);
    // The round is played on twist, and the wiper signal is recorded all the same.
    expect(first[cols.indexOf('wiper')]).toBe(700);
    expect(first[cols.indexOf('lane')]).toEqual(expect.any(Number));
    expect(pose[0].n).toBeGreaterThan(30);
    expect(pose[pose.length - 1].reason).toBe('round-end');
    expect(shot.reduce((sum, batch) => sum + batch.n, 0)).toBe(postedRecords(routes)[0].run.shots_fired);
    const hitCol = shot[0].cols.indexOf('hit');
    expect(shot.flatMap((batch) => batch.rows).every((row) => [0, 1, null].includes(row[hitCol]))).toBe(true);
    expect(shot[0]).toMatchObject({ kind: 'round', runId, gesture: 'twist' });
  });

  it('flushes the traces when the round is left early', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await start();
    await hold(wiperPose(0), 500);
    await step();
    await hold(wiperPose(0), 1000);
    await keyDown('Escape');
    await press(/^Exit/);
    expect(traces('skyline_invaders.pose.trace')).toEqual([expect.objectContaining({ reason: 'abandoned', kind: 'round' })]);
    expect(traces('skyline_invaders.shot.trace')).toEqual([expect.objectContaining({ reason: 'abandoned' })]);
  });

  it('records each tryout card under its own gesture, with the practice target the cannon is on', async () => {
    await mount({ controls: null });
    await status('detecting');
    await press(/Pick your controls/);
    await hold(wiperPose(0), 300);
    await hold(poseForLane(0), 1200);
    await step();                                   // next card: twist
    await hold(wiperPose(0), 500);
    await stomp();
    await flush();
    const pose = traces('skyline_invaders.pose.trace');
    expect(pose.map((batch) => [batch.kind, batch.gesture, batch.card, batch.reason])).toEqual([['tryout', 'wiper', 0, 'begin'], ['tryout', 'twist', 1, 'tryout-chosen']]);
    const { tryoutId } = logged('skyline_invaders.controls.opened')[0];
    expect(pose[0].runId).toBe(tryoutId);
    expect(logged('skyline_invaders.controls.tryout')[0].tryoutId).toBe(tryoutId);
    expect(logged('skyline_invaders.controls.chosen')[0].tryoutId).toBe(tryoutId);
    const target = pose[0].cols.indexOf('target');
    expect(pose[0].rows.some((row) => row[target] === 1)).toBe(true);      // on the left target
    expect(pose[0].rows[pose[0].rows.length - 1][pose[0].cols.indexOf('lane')]).toBe(0);
    expect(traces('skyline_invaders.shot.trace')).toHaveLength(0);
  });
});

describe('Skyline Invaders exit', () => {
  it('leaves from the lobby by the Exit button, and by Escape', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await press(/^Exit/);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'lobby', how: 'button', round: null });
    await keyDown('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(logged('skyline_invaders.exit')[1]).toMatchObject({ how: 'back' });
    expect(postedRecords(routes)).toHaveLength(0);
  });

  it('leaving mid-round from the pause menu saves the round as abandoned and closes at once', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await start();
    await step();
    await f.seconds(2);
    await keyDown('Escape');
    expect(phase()).toBe('paused');
    await press(/^Exit/);
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    const [record] = postedRecords(routes);
    expect(record.run).toMatchObject({ status: 'abandoned', steps: 1 });
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'paused', how: 'button', round: 'abandoned', runId: record.run.id });
    expect(logged('skyline_invaders.level.end')[0]).toMatchObject({ status: 'abandoned' });
  });

  it('leaving does not wait for a save that fails', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    routes.runs.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await start();
    await keyDown('Escape');
    await press(/^Exit/);
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    expect(logged('skyline_invaders.round.save_error')).toHaveLength(1);
  });

  it('leaves from the result screen, saved or not, and tries a failed save once more on the way out', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    routes.runs.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await start();
    await f.seconds(31);
    await flush();
    expect(screen.getByTestId('skyline-invaders-result').getAttribute('data-save')).toBe('error');
    await press(/^Exit/);
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    expect(postedRecords(routes)).toHaveLength(2);
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'result', round: 'error' });
  });

  it('Escape during the countdown goes back to the lobby without saving anything', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await press(/^Start/);
    await f.seconds(1);
    expect(phase()).toBe('countdown');
    await keyDown('Escape');
    expect(phase()).toBe('lobby');
    await f.seconds(4);
    expect(phase()).toBe('lobby');
    expect(onClose).not.toHaveBeenCalled();
    expect(postedRecords(routes)).toHaveLength(0);
    expect(logged('skyline_invaders.level.countdown_cancelled')).toHaveLength(1);
  });

  it('offers no Exit when the host gave no way to close', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: /^Exit/ })).toBeNull();
    await keyDown('Escape');
    expect(phase()).toBe('lobby');
  });
});
