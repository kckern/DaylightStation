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
// The game's own volume lives in the fitness volume store (VolumeProvider);
// these suites are not about it (SkylineInvaders.sound.test.jsx is).
vi.mock('../../nav/usePersistentVolume.js', () => ({ usePersistentVolume: () => ({ volume: 0.6, muted: false, source: 'global', setVolume: () => {}, toggleMute: () => {} }) }));

import SkylineInvaders from './SkylineInvaders.jsx';
import { laneX } from '../../lib/skylineInvaders/lanes.js';
import { xToAim } from '../../lib/skylineInvaders/threats.js';
import { INVADERS_TUNABLES } from '../../lib/skylineInvaders/tunables.js';
import { flush, handsPose, installFrames, makeCtx, poseForAim, poseForLane, postedRecords, routeFetch, standingPose, testLevel, wiperPose } from './invadersTestKit.js';

let routes;
let f;
// The touch keys by position: 1-4 are the screen's decision, 5 is Controls, 6 is Exit.
const keyAt = (n) => document.querySelector(`.skyline-invaders__key[data-position="${n}"]`);
const pad = (n) => act(async () => { expect(keyAt(n), `touch key ${n} should be on screen`).not.toBeNull(); fireEvent.click(keyAt(n)); });
// Exit, pressed by someone who has looked at the screen first (a fresh Exit ignores a tap).
const padExit = async () => { await act(async () => { vi.advanceTimersByTime(600); }); await pad(6); };
const padLabels = () => [...document.querySelectorAll('.skyline-invaders__key')].map((k) => k.querySelector('strong').textContent);
// People are tiles. With nobody on the mat, the defender is picked from everyone (Someone else).
const tapPerson = async (name) => {
  const find = () => [...document.querySelectorAll('.skyline-invaders__person')].find((tile) => tile.querySelector('strong').textContent === name);
  if (!find()) await act(async () => { fireEvent.click(screen.getByTestId('invaders-person-more')); });
  expect(find(), `${name} should be offered as a defender`).toBeTruthy();
  await act(async () => { fireEvent.click(find()); });
};
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
const passed = () => screen.getByTestId('invaders-kills').getAttribute('data-passed');
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
const menuScreen = () => document.querySelector('.skyline-invaders').getAttribute('data-screen');
const tapMethod = (method) => act(async () => { fireEvent.click(screen.getByTestId(`invaders-method-${method}`)); });
// Poses that take each method's cannon to the left edge, the right edge, and the middle.
const SWEEP_POSES = {
  wiper: { mid: poseForLane(3), left: poseForLane(0), right: poseForLane(7) },
  drag: { mid: handsPose(0, { drop: 0.6 }), left: handsPose(-1, { drop: 0.3 }), right: handsPose(1, { drop: 0.3 }) },
};
// The test sweep: go left, go right, step on the mat. "It works!" stays up a moment, then hands back.
async function passSweep(method = 'wiper') {
  expect(menuScreen()).toBe('sweep');
  const poses = SWEEP_POSES[method];
  await hold(poses.mid, 300);
  await hold(poses.left, 2000);
  await hold(poses.right, 2500);
  expect(screen.getByTestId('invaders-sweep-step-fire').getAttribute('data-state')).toBe('now');
  await step();
  expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('It works!');
  await f.seconds(1.6);
}
// Start: key 4 on the wave list. Until the defender's method has passed its
// test in this visit, Start opens the setup: choose the method, pass the
// sweep, and the round counts down. After that, with a camera, the Ready
// screen comes first and passes once the defender has stood in view for a second.
async function start(method = 'wiper') {
  await pad(4);
  if (menuScreen() === 'method') { await tapMethod(method); await passSweep(method); }
  else if (phase() === 'ready') await hold(wiperPose(0), 1200);
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
  h.audio = { loadSounds: vi.fn(async () => ({ loaded: [], missing: [] })), prime: vi.fn(async () => true), playCue: vi.fn(() => true), setMuted: vi.fn(), setVolume: vi.fn(), stop: vi.fn() };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Skyline Invaders controls', () => {
  it('first time: Start opens the setup; choose a method, the sweep ticks left, right and fire only when each is detected, and the round starts', async () => {
    await mount({ controls: null });
    await status('detecting');
    await pad(4);
    expect(menuScreen()).toBe('method');
    await tapMethod('wiper');
    expect(menuScreen()).toBe('sweep');
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Go left');
    // Standing still is not going left.
    await hold(poseForLane(3), 2000);
    expect(screen.getByTestId('invaders-sweep-step-left').getAttribute('data-state')).toBe('now');
    // A step on the mat before the fire step does nothing.
    await step();
    expect(screen.getByTestId('invaders-sweep-step-left').getAttribute('data-state')).toBe('now');
    await hold(poseForLane(0), 1000);
    expect(cannonLane()).toBe(0);
    expect(screen.getByTestId('invaders-sweep-step-left').getAttribute('data-state')).toBe('done');
    expect(document.querySelector('[data-practice-target="left"]').getAttribute('data-reached')).toBe('true');
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Go right');
    await hold(poseForLane(7), 1000);
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Stomp to fire');
    // Another mat does not count.
    await step('mat-b2');
    expect(screen.getByTestId('invaders-sweep-step-fire').getAttribute('data-state')).toBe('now');
    await stomp();
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('It works!');
    await f.seconds(1.6);
    await flush();
    expect(phase()).toBe('countdown');
    expect(routes.controls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(routes.controls.mock.calls[0][1].body)).toEqual({ gesture: 'wiper' });
    expect(logged('skyline_invaders.setup.method_chosen')[0]).toMatchObject({ shooterId: 'kid', method: 'wiper', how: 'touch', previous: null });
    expect(logged('skyline_invaders.setup.step').map((entry) => [entry.step, entry.result])).toEqual([['left', 'passed'], ['right', 'passed'], ['fire', 'passed']]);
    expect(logged('skyline_invaders.setup.step')[2]).toMatchObject({ source: 'mat-stomp' });
    expect(logged('skyline_invaders.setup.passed')[0]).toMatchObject({ shooterId: 'kid', method: 'wiper', from: 'start' });
    expect(logged('skyline_invaders.setup.method_changed')[0]).toMatchObject({ shooterId: 'kid', method: 'wiper', previous: null, saved: true });
    await f.seconds(3.1);
    expect(phase()).toBe('playing');
    await pointAtFirstMeteor();
    await step();
    await f.seconds(1.2);
    expect(passed()).toBe('true');
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ gesture: 'wiper', gestureChosen: true, aimMode: 'pose' });
  });

  it('a method that does not work is caught before the round: the step times out, Try again, or choose another and test that', async () => {
    // 2026-11-13 on the garage: Slide was picked by a stomp, the defender steered like a wheel, and the cannon sat at the edge all round.
    await mount({ controls: null });
    await status('detecting');
    await pad(4);
    await tapMethod('drag');
    expect(h.bridge.tracker.gesture()).toBe('drag');
    await hold(handsPose(0), (INVADERS_TUNABLES.setupStepTimeoutS + 0.5) * 1000);   // hands on a wheel in front, under Slide: the cannon does not go
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Not detected');
    expect(screen.getByTestId('invaders-sweep-step-left').getAttribute('data-state')).toBe('failed');
    expect(padLabels()).toEqual(['Try again', 'Choose another']);
    expect(logged('skyline_invaders.setup.step').at(-1)).toMatchObject({ method: 'drag', step: 'left', result: 'timeout' });
    expect(phase()).toBe('lobby');                  // nothing started
    await pad(1);
    expect(screen.getByTestId('invaders-sweep-headline').textContent).toBe('Go left');
    expect(logged('skyline_invaders.setup.retry')[0]).toMatchObject({ method: 'drag', step: 'left', attempt: 2 });
    await pad(3);                                   // Choose another
    expect(menuScreen()).toBe('method');
    await tapMethod('wiper');
    await passSweep('wiper');
    await flush();
    expect(phase()).toBe('countdown');
    expect(JSON.parse(routes.controls.mock.calls[0][1].body)).toEqual({ gesture: 'wiper' });
  });

  it('a method passed once in a visit is not tested again: the next Start is the Ready screen', async () => {
    await mount();
    await status('detecting');
    await start();
    await keyDown('Escape');
    await pad(3);                                   // End round
    await flush();
    await pad(3);                                   // Waves
    expect(menuScreen()).toBe('waves');
    await pad(4);
    expect(menuScreen()).toBe('ready');
  });

  it('a defender with saved controls is tested on them: the list opens on their own, marked', async () => {
    await mount({ controls: { gesture: 'sprinkler' } });
    await status('detecting');
    expect(keyAt(5).getAttribute('title')).toBe('Sprinkler');
    expect(h.bridge.tracker.gesture()).toBe('sprinkler');
    await pad(4);
    // Under touch no tile is lit as if chosen; their own is marked Yours.
    expect(document.querySelector('.skyline-invaders__method[aria-pressed="true"]')).toBeNull();
    expect(screen.getByTestId('invaders-method-sprinkler').hasAttribute('data-current')).toBe(true);
    expect(screen.getByTestId('invaders-method-sprinkler').textContent).toBe('SprinklerYours');
    await pad(3);
    expect(h.bridge.tracker.gesture()).toBe('sprinkler');
    expect(routes.controls).not.toHaveBeenCalled();
  });

  it('the method can be changed mid-round from the pause screen: the round waits, the new method is tested, and the record carries it', async () => {
    await mount();
    await status('detecting');
    await start();
    await keyDown('Escape');
    expect(padLabels()).toEqual(['Resume', 'Sound', 'End round', 'Controls']);
    await pad(4);
    expect(menuScreen()).toBe('method');
    expect(phase()).toBe('paused');
    expect(padLabels()).toEqual(['Back']);
    expect(screen.getByTestId('invaders-method-wiper')).toBeTruthy();
    await pad(3);                                   // Back: the pause screen
    expect(menuScreen()).toBe('paused');
    await pad(4);
    await tapMethod('drag');
    await passSweep('drag');
    expect(menuScreen()).toBe('paused');
    expect(h.bridge.tracker.gesture()).toBe('drag');
    // A workout resume never restarts the round under the setup.
    await pad(4);
    await act(async () => { h.lifecycle.onPause(); h.lifecycle.onResume(); });
    expect(phase()).toBe('paused');
    await pad(3);
    await pad(1);                                   // Resume
    expect(phase()).toBe('playing');
    await keyDown('Escape');
    await pad(3);                                   // End round
    await flush();
    expect(postedRecords(routes)[0].run.gesture).toBe('drag');
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
    await tapPerson('Kid');
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
    const lostBefore = logged('skyline_invaders.pose.lost').length;
    await hold(standingPose(), 3000);
    expect(cannonLane()).toBe(6);
    expect(hud()).not.toContain('Step into view');
    expect(logged('skyline_invaders.pose.lost')).toHaveLength(lostBefore);
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

  it('a workout that ends while the setup is open over a paused round saves the round and closes the setup', async () => {
    await mount();
    await status('detecting');
    await start();
    await keyDown('Escape');
    await pad(4);
    await tapMethod('drag');
    expect(menuScreen()).toBe('sweep');
    await act(async () => { h.lifecycle.onSessionEnd(); });
    await flush();
    expect(phase()).toBe('result');
    expect(postedRecords(routes)[0].run.status).toBe('abandoned');
    await pad(3);                                   // Waves
    expect(menuScreen()).toBe('waves');
    expect(h.bridge.tracker.gesture()).toBe('wiper');
  });

  it('aim help: out of view for a while, the round says so and offers Controls, which pauses and opens the setup', async () => {
    await mount();
    await status('detecting');
    await start();
    await hold(poseForLane(3), 500);
    expect(screen.queryByTestId('invaders-aim-help')).toBeNull();
    await f.seconds(INVADERS_TUNABLES.poseLostAfterMs / 1000 + INVADERS_TUNABLES.aimHelpLostS + 0.3);
    const help = screen.getByTestId('invaders-aim-help');
    expect(help.getAttribute('data-kind')).toBe('lost');
    expect(help.textContent).toContain('Can’t see you');
    expect(hud()).not.toContain('Step into view');     // one message on the strip, not two
    expect(logged('skyline_invaders.round.aim_help')[0]).toMatchObject({ kind: 'lost', gesture: 'wiper' });
    await act(async () => { fireEvent.click(screen.getByTestId('invaders-aim-help-controls')); });
    expect(phase()).toBe('paused');
    expect(menuScreen()).toBe('method');
    expect(logged('skyline_invaders.setup.opened')[1]).toMatchObject({ from: 'paused' });
  });

  it('aim help: in view but the cannon stuck in one lane, the round asks whether it is moving; moving clears it', async () => {
    await mount();
    await status('detecting');
    await start();
    await hold(poseForLane(5), (INVADERS_TUNABLES.aimHelpStuckS + 0.5) * 1000);
    expect(screen.getByTestId('invaders-aim-help').getAttribute('data-kind')).toBe('stuck');
    expect(screen.getByTestId('invaders-aim-help').textContent).toContain('Cannon not moving?');
    expect(screen.queryByTestId('invaders-controls')).toBeNull();     // the strip is the aim help's alone
    await hold(poseForLane(1), 800);
    expect(screen.queryByTestId('invaders-aim-help')).toBeNull();
  });

  it('keyboard round: no camera and no mat, Space fuels the stream, the arrows move the cannon lane by lane, and the round is saved with its stars', async () => {
    h.ctx = makeCtx({ matRider: null });
    h.ctx.equipment = h.ctx.equipment.filter((item) => item.id !== 'step-mat');
    await mount({ controls: null });
    await status('camera-denied');
    await tapPerson('Kid');
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
    expect(passed()).toBe('true');
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
    await mount({ controls: { gesture: 'drag' } });
    await status('detecting');
    await start('drag');
    await hold(wiperPose(20), 1000);
    await step();
    await hold(wiperPose(20), 3000);
    expect(traces('skyline_invaders.pose.trace').filter((batch) => batch.kind === 'round')).toHaveLength(0);     // batched, not per frame
    await f.seconds(27);
    await flush();
    const pose = traces('skyline_invaders.pose.trace').filter((batch) => batch.kind === 'round');
    const shot = traces('skyline_invaders.shot.trace');
    expect(pose.length).toBeGreaterThanOrEqual(1);
    expect(pose.length).toBeLessThanOrEqual(3);
    const { runId } = logged('skyline_invaders.level.start')[0];
    expect(pose[0]).toMatchObject({ kind: 'round', runId, levelId: 'invaders-test', shooterId: 'kid', gesture: 'drag', gestureKind: 'velocity', hz: 10, seq: 0 });
    const cols = pose[0].cols;
    const first = pose[0].rows[0];
    expect(first).toHaveLength(cols.length);
    // The round is played on Slide, and the wiper signal is recorded all the same.
    expect(pose[0].rows.some((row) => row[cols.indexOf('wiper')] === 700)).toBe(true);
    expect(first[cols.indexOf('lane')]).toEqual(expect.any(Number));
    expect(pose[0].rows.filter((row) => row[cols.indexOf('step')] === 1)).toHaveLength(1);     // the one mat step
    expect(pose[0].n).toBeGreaterThan(30);
    expect(pose[pose.length - 1].reason).toBe('round-end');
    expect(shot.reduce((sum, batch) => sum + batch.n, 0)).toBe(postedRecords(routes)[0].run.shots_fired);
    const hitCol = shot[0].cols.indexOf('hit');
    expect(shot.flatMap((batch) => batch.rows).every((row) => [0, 1, null].includes(row[hitCol]))).toBe(true);
    expect(shot[0]).toMatchObject({ kind: 'round', runId, gesture: 'drag' });
  });

  it('a setup opened from a paused round keeps the round\'s own trace going', async () => {
    await mount();
    await status('detecting');
    await start();
    await hold(wiperPose(10), 500);
    await keyDown('Escape');
    await pad(4);
    await tapMethod('drag');
    await pad(3);                                   // Choose another
    await pad(3);                                   // Back to the pause screen
    await pad(1);                                   // Resume
    await hold(wiperPose(10), 1000);
    await f.seconds(30);
    await flush();
    const round = traces('skyline_invaders.pose.trace').filter((batch) => batch.kind === 'round');
    expect(round.at(-1).reason).toBe('round-end');
    expect(traces('skyline_invaders.pose.trace').filter((batch) => batch.kind === 'tryout' && batch.runId !== logged('skyline_invaders.setup.opened')[0].setupId)).toHaveLength(0);
  });

  it('flushes the traces when the round is left early', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await start();
    await hold(wiperPose(0), 500);
    await step();
    await hold(wiperPose(0), 1000);
    await keyDown('Escape');
    await padExit();
    expect(traces('skyline_invaders.pose.trace').filter((batch) => batch.kind === 'round')).toEqual([expect.objectContaining({ reason: 'abandoned', kind: 'round' })]);
    expect(traces('skyline_invaders.shot.trace')).toEqual([expect.objectContaining({ reason: 'abandoned' })]);
  });

  it('records each test sweep under its method, with the edge target the cannon is on, joined to the setup by its id', async () => {
    await mount({ controls: null });
    await status('detecting');
    await pad(5);
    await tapMethod('drag');
    await hold(handsPose(0), 500);
    await pad(3);                                   // Choose another
    await tapMethod('wiper');
    await passSweep('wiper');
    await flush();
    const pose = traces('skyline_invaders.pose.trace');
    expect(pose.map((batch) => [batch.kind, batch.gesture, batch.card, batch.reason])).toEqual([['tryout', 'drag', 5, 'tryout-closed'], ['tryout', 'wiper', 0, 'tryout-chosen']]);
    const { setupId } = logged('skyline_invaders.setup.opened')[0];
    expect(pose[0].runId).toBe(setupId);
    expect(logged('skyline_invaders.setup.passed')[0].setupId).toBe(setupId);
    const target = pose[1].cols.indexOf('target');
    expect(pose[1].rows.some((row) => row[target] === 1)).toBe(true);      // going for the left edge
    expect(pose[1].rows.some((row) => row[target] === 3)).toBe(true);      // then the right
    expect(traces('skyline_invaders.shot.trace')).toHaveLength(0);
  });
});

describe('Skyline Invaders exit', () => {
  it('leaves from the lobby by the Exit button, and by Escape', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    expect(keyAt(6).querySelector('strong').textContent).toBe('Exit');
    await padExit();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'lobby', how: 'touch', round: null });
    await keyDown('ArrowDown');                    // down is Exit on every menu screen
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(logged('skyline_invaders.exit')[1]).toMatchObject({ how: 'key' });
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
    expect(padLabels()).toEqual(['Resume', 'Sound', 'End round', 'Controls', 'Exit']);
    await padExit();
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    const [record] = postedRecords(routes);
    expect(record.run).toMatchObject({ status: 'abandoned', steps: 1 });
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'paused', how: 'touch', round: 'abandoned', runId: record.run.id });
    expect(logged('skyline_invaders.level.end')[0]).toMatchObject({ status: 'abandoned' });
  });

  it('an Exit key that just appeared under the finger ignores the tap; a moment later it leaves', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await pad(4);                                   // Start opens Choose your controls
    expect(document.querySelector('[data-screen="method"]')).not.toBeNull();
    await pad(6);                                   // the same tap, landing on the new screen's Exit
    expect(onClose).not.toHaveBeenCalled();
    expect(logged('skyline_invaders.control.ignored')[0]).toMatchObject({ position: 6, screen: 'method', reason: 'fresh-exit' });
    await padExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a round has its own Exit key beside Pause: one tap saves the round as abandoned and leaves', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await start();
    await step();
    await f.seconds(2);
    const exitKey = screen.getByTestId('skyline-invaders-exit');
    expect(exitKey.textContent).toBe('Exit');
    expect(screen.getByTestId('skyline-invaders-pause')).toBeTruthy();
    await act(async () => { fireEvent.click(exitKey); });
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    expect(postedRecords(routes)[0].run).toMatchObject({ status: 'abandoned', steps: 1 });
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'playing', how: 'touch', round: 'abandoned' });
  });

  it('gamepad Select leaves a round at once; the countdown has the Exit key too', async () => {
    const onClose = vi.fn();
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => [{ axes: [0, 0], buttons }], configurable: true, writable: true });
    await mount({ onClose });
    await pad(4);
    await tapMethod('wiper');
    await passSweep();
    expect(phase()).toBe('countdown');
    expect(screen.getByTestId('skyline-invaders-exit')).toBeTruthy();
    await f.seconds(3.1);
    buttons[8] = { pressed: true };
    await f.frames(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'playing', how: 'gamepad', round: 'abandoned' });
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true, writable: true });
  });

  it('leaving does not wait for a save that fails', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    routes.runs.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await start();
    await keyDown('Escape');
    await padExit();
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
    expect(padLabels()).toEqual(['Retry save', 'Exit']);
    await pad(6);
    expect(onClose).toHaveBeenCalledTimes(1);
    await flush();
    expect(postedRecords(routes)).toHaveLength(2);
    expect(logged('skyline_invaders.exit')[0]).toMatchObject({ phase: 'result', round: 'error' });
  });

  it('Escape during the countdown goes back to the lobby without saving anything', async () => {
    const onClose = vi.fn();
    await mount({ onClose });
    await pad(4);
    await tapMethod('wiper');
    await passSweep();
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
    expect(keyAt(6)).toBeNull();
    await keyDown('ArrowDown');
    expect(phase()).toBe('lobby');
    expect(logged('skyline_invaders.exit')).toHaveLength(0);
  });
});
