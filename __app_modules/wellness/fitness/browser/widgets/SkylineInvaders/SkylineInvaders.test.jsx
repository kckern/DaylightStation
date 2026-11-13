import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ctx: null, bridge: null, lifecycle: null, audio: null, localDev: true, entitlement: { items: [] },
  registerAdmin: null, clearUnlock: null,
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn() },
}));
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => h.ctx }));
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => h.log }) }));
vi.mock('@/lib/kioskEnv.js', () => ({ isLocalDevHost: () => h.localDev, isKioskEnv: () => !h.localDev }));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => { if (h.entitlement instanceof Error) throw h.entitlement; return h.entitlement; }),
  DaylightMediaPath: (path) => path,
  DaylightImagePath: (path) => path,
}));
vi.mock('../../identity/useIdentity.js', () => ({
  useIdentity: () => ({ registerAdmin: h.registerAdmin, clearUnlock: h.clearUnlock, unlockState: 'idle', unlockedUser: null }),
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
import { manifest } from './index.jsx';
import { xToAim } from '../../lib/skylineInvaders/threats.js';
import { flush, installFrames, makeCtx, poseForAim, postedRecords, routeFetch, standingPose, testLevel, wiperPose } from './invadersTestKit.js';

let routes;
let f;
const logged = (name, method = 'info') => h.log[method].mock.calls.filter(([event]) => event === name).map(([, data]) => data);
const button = (name) => screen.getByRole('button', { name });
const press = (name) => act(async () => { fireEvent.click(button(name)); });
// The touch keys: a screen's actions, by position (1–4). Blank positions are not drawn.
const key4 = (n) => document.querySelector(`.skyline-invaders__key[data-position="${n}"]`);
const pad = (n) => act(async () => { fireEvent.click(key4(n)); });
// People are tiles: Who's defending? and Pick the defender.
const tiles = () => [...document.querySelectorAll('.skyline-invaders__person')];
const tileNames = () => tiles().map((tile) => tile.querySelector('strong').textContent);
const tapPerson = (name) => act(async () => { fireEvent.click(tiles().find((tile) => tile.querySelector('strong').textContent === name)); });
const gamepads = (list) => Object.defineProperty(navigator, 'getGamepads', { value: () => list, configurable: true, writable: true });
const padLabels = () => [...document.querySelectorAll('.skyline-invaders__key')].map((k) => k.querySelector('strong').textContent);
const menuScreen = () => document.querySelector('[data-testid="skyline-invaders"], [data-testid="skyline-invaders-play"]')?.getAttribute('data-screen') || null;
const key = (k, init = {}) => act(async () => { fireEvent.keyDown(window, { key: k, ...init }); });
const step = (id = 'mat-a1', type = 'pressure-mat:step') => act(async () => { h.ctx.__emitAppEvent(type, { id }); });
const feed = (p) => act(async () => { h.bridge.tracker.processPoses(p ? [p] : []); });
const status = (state, over = {}) => act(async () => { h.bridge.onStatus({ state, fps: 13, latency: 70, backend: 'wasm', modelType: 'full', error: null, ...over }); });
const kills = () => screen.getByTestId('invaders-kills').textContent;
const entitlement = (decision = 'denied', riderId = 'kid') => ({
  items: [{
    capabilityId: 'fitness.skyline-invaders', gateId: 'school.day-complete', decision, basisState: decision === 'granted' ? 'satisfied' : 'unsatisfied',
    degraded: false, subject: { kind: 'learner', id: riderId },
    period: { kind: 'interval', id: 'school-day:2026-10-07', startsAt: 0, endsAt: Date.now() + 86_400_000 },
    validFrom: 0, validUntil: Date.now() + 86_400_000,
  }],
});

async function mount(options = {}) {
  f = installFrames();
  routes = routeFetch(options);
  options.prepare?.(routes);
  const view = render(<SkylineInvaders />);
  await flush();
  return view;
}
// Start from the wave list and sit through the 3-2-1. Without a camera there is
// no Ready screen: straight to the countdown with gamepad aim.
async function startRound() {
  await status('camera-denied');
  await pad(4);
  await f.seconds(3.1);
  expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('playing');
}
// Point at the first meteor on screen, step on the mat, and wait for the shot to land.
async function shootFirstMeteor() {
  await f.frames(2);
  const meteor = document.querySelector('[data-threat="meteor"]');
  expect(meteor, 'a meteor should be on screen').not.toBeNull();
  const aim = xToAim(Number(meteor.getAttribute('data-x')));
  for (let i = 0; i < 6; i += 1) { await feed(poseForAim(aim)); await f.frames(1); }
  await step();
  await f.seconds(1.2);
  // One step fuels a stream: it takes the meteor aimed at, and any other that crosses that lane.
  expect(screen.getByTestId('invaders-kills').getAttribute('data-passed')).toBe('true');
}

beforeEach(() => {
  Object.values(h.log).forEach((fn) => fn.mockClear());
  h.ctx = makeCtx();
  h.bridge = null;
  h.lifecycle = null;
  h.localDev = true;
  h.entitlement = { items: [] };
  h.registerAdmin = vi.fn(async () => ({ matched: false, reason: 'denied' }));
  h.clearUnlock = vi.fn();
  h.audio = {
    loadSounds: vi.fn(async () => ({ loaded: [], missing: [] })), prime: vi.fn(async () => true),
    playCue: vi.fn(() => true), setMuted: vi.fn(), setVolume: vi.fn(), stop: vi.fn(),
  };
});
// Unmount while the fake clock is still in place, so every cleanup runs against it.
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('manifest', () => {
  it('registers as a full-viewport standalone game', () => {
    expect(manifest).toMatchObject({ id: 'skyline_invaders', name: 'Skyline Invaders', fullscreen: true, modes: { standalone: true } });
  });
});

describe('SkylineInvaders — levels and the frame loop', () => {
  it('shows the loading state, then the lobby once levels load, and logs the mount', async () => {
    f = installFrames();
    routes = routeFetch();
    render(<SkylineInvaders />);
    expect(screen.getByTestId('skyline-invaders-loading')).toBeTruthy();
    await flush();
    expect(menuScreen()).toBe('waves');
    expect(logged('skyline_invaders.mounted')[0]).toMatchObject({ sessionId: 'fs-test', mats: 1, poseModel: 'full' });
    expect(logged('skyline_invaders.levels.loaded')[0]).toMatchObject({ levels: 1 });
  });

  it('drops an invalid level and logs it', async () => {
    await mount({ levels: [testLevel(), { ...testLevel(), id: 'Bad Id' }] });
    expect(screen.getAllByRole('button', { name: /Test Wave/ })).toHaveLength(1);
    expect(logged('skyline_invaders.level.invalid', 'warn')[0]).toMatchObject({ levelId: 'Bad Id', errors: expect.any(Array) });
  });

  it('says No levels installed when none is valid', async () => {
    await mount({ levels: [] });
    expect(screen.getByRole('alert').textContent).toMatch(/No levels installed/);
    expect(logged('skyline_invaders.levels.error', 'error')).toHaveLength(1);
  });

  it('offers a working Try again when the level request fails', async () => {
    await mount({ prepare: (r) => r.levels.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) }) });
    expect(screen.getByRole('alert').textContent).toMatch(/Levels unavailable/);
    await press(/Try again/);
    await flush();
    expect(menuScreen()).toBe('waves');
  });

  it('counts 3, 2, 1 and then plays, logging the start with the level and a numeric seed', async () => {
    await mount();
    await status('camera-denied');
    await pad(4);
    const countdown = () => document.querySelector('.game-hud-countdown')?.textContent;
    expect(countdown()).toBe('3');
    await f.seconds(1);
    expect(countdown()).toBe('2');
    await f.seconds(1);
    expect(countdown()).toBe('1');
    expect(logged('skyline_invaders.level.start')).toHaveLength(0);
    await f.seconds(1.1);
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('playing');
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-run-role')).toBe('playing');
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ levelId: 'invaders-test', seed: expect.any(Number), shooterId: 'kid', aimMode: 'manual', runId: expect.any(String) });
    expect(h.audio.prime).toHaveBeenCalled();
    expect(h.ctx.setGovernanceSuspended).toHaveBeenCalledWith(true);
  });

  it('turns a mat step into fuel for the stream, and ignores other mats', async () => {
    await mount();
    await startRound();
    await step('mat-other');
    await f.frames(1);
    expect(document.querySelectorAll('[data-shot]')).toHaveLength(0);
    await step();
    await f.frames(1);
    expect(document.querySelectorAll('[data-shot]')).toHaveLength(1);
    expect(screen.getByTestId('invaders-fuel').getAttribute('data-empty')).toBe('false');
  });

  it('logs a frame that throws and keeps drawing', async () => {
    await mount();
    await startRound();
    const good = h.ctx.fitnessSessionInstance.getEquipmentCadence;
    h.ctx.fitnessSessionInstance.getEquipmentCadence = () => { h.ctx.fitnessSessionInstance.getEquipmentCadence = good; throw new Error('cadence exploded'); };
    h.ctx.riders.bike = 'test-rider';
    await f.frames(2);
    expect(h.log.sampled.mock.calls.filter(([name]) => name === 'skyline_invaders.frame.error')[0][1]).toMatchObject({ error: 'cadence exploded', levelId: 'invaders-test' });
    const before = screen.getByTestId('invaders-time').textContent;
    await f.seconds(2);
    expect(screen.getByTestId('invaders-time').textContent).not.toBe(before);
  });

  it('shows the result when the round runs out its timer', async () => {
    await mount();
    await startRound();
    await f.seconds(30.5);
    expect(screen.getByTestId('skyline-invaders-result')).toBeTruthy();
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-run-role')).toBe('result');
  });
});

describe('SkylineInvaders — lobby, controls, Ready, pose and lifecycle', () => {
  it('asks who is defending, from the people in the workout, when the mat has nobody; the pick goes on the mat', async () => {
    h.ctx = makeCtx({ matRider: null });
    h.ctx.participantRoster = [{ id: 'kid', name: 'Kid' }];
    await mount();
    expect(menuScreen()).toBe('who');
    expect(tileNames()).toEqual(['Kid', 'Someone else']);
    expect(padLabels()).toEqual([]);
    await tapPerson('Kid');
    expect(h.ctx.fitnessSessionInstance.setEquipmentUser).toHaveBeenCalledWith('step-mat', 'kid');
    expect(menuScreen()).toBe('waves');
    expect(screen.getByTestId('skyline-invaders-waves').textContent).toContain('Kid is defending');
  });

  it('keeps everyone else behind Someone else: the roster is tiles to tap', async () => {
    h.ctx = makeCtx({ matRider: null });
    await mount();
    expect(screen.getByTestId('skyline-invaders-who').textContent).toContain('Nobody is in the workout yet');
    expect(tileNames()).toEqual(['Someone else']);
    await tapPerson('Someone else');
    expect(menuScreen()).toBe('roster');
    expect(padLabels()).toEqual(['Back']);
    expect(tileNames()).toContain('Test Rider');
    await tapPerson('Test Rider');
    expect(screen.getByTestId('skyline-invaders').getAttribute('data-shooter-id')).toBe('test-rider');
  });

  it('one decision per screen: the wave list is the waves and its keys, no prose', async () => {
    await mount({ levels: [testLevel(), testLevel({ id: 'invaders-test-2', name: 'Second Wave', waves: [{ at: 0, rate_s: 2, spawn: { drone: 1 } }] })] });
    expect(menuScreen()).toBe('waves');
    expect(padLabels()).toEqual(['Previous', 'Next', 'Change defender', 'Start']);
    expect(key4(4).textContent).toContain('Or stomp the mat');
    expect(document.querySelector('.skyline-controls')).toBeNull();
    const waves = screen.getByTestId('skyline-invaders-waves');
    expect(waves.textContent).not.toMatch(/Space|any key|Tap a button|Vision engine|Calibrate|Exit/);
    expect(screen.getByTestId('invaders-wave-detail').textContent).toBe('New: Meteors · Shoot down 1 · 0:30');
    await pad(2);
    expect(screen.getByTestId('invaders-wave-detail').textContent).toBe('New: Drones · Shoot down 1 · 0:30');
    expect(screen.getByTestId('skyline-invaders').getAttribute('data-level-id')).toBe('invaders-test-2');
  });

  it('a stomp on the shooter\'s mat is Start; another mat\'s stomp is not', async () => {
    await mount();
    await status('camera-denied');
    await step('mat-other', 'pressure-mat:stomp');
    expect(menuScreen()).toBe('waves');
    await step('mat-a1', 'pressure-mat:stomp');
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('countdown');
  });

  it('Ready: stand on the mat in view, and the countdown starts by itself in pose mode; no reach is measured', async () => {
    await mount({ controls: { gesture: 'twist' } });
    await status('detecting');
    await pad(4);
    expect(menuScreen()).toBe('ready');
    expect(padLabels()).toEqual(['Back']);
    expect(screen.getByRole('heading').textContent).toBe('Stand on the mat.');
    expect(screen.queryByLabelText('Steps')).toBeNull();
    const hold = async (p, ms) => { for (let t = 0; t < ms; t += 100) { await feed(p); await f.frames(1); } };
    await hold(standingPose(), 1300);   // standing, hands out of frame
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('countdown');
    await f.seconds(3.1);
    expect(logged('skyline_invaders.level.start')[0]).toMatchObject({ aimMode: 'pose', gesture: 'twist', gestureChosen: true });
    await f.seconds(30.5);
    await flush();
    expect(logged('skyline_invaders.level.end')[0]).toMatchObject({ gesture: 'twist' });
    expect(postedRecords(routes)[0].run.gesture).toBe('twist');
  });

  it('a defender with a camera and no saved controls picks them first: key 4 is Pick controls, and closing the intro keeps the default', async () => {
    await mount();
    await status('detecting');
    expect(padLabels()).toEqual(['Previous', 'Next', 'Change defender', 'Pick controls']);
    await pad(4);
    expect(menuScreen()).toBe('controls');
    expect(logged('skyline_invaders.controls.opened')[0]).toMatchObject({ shooterId: 'kid', current: null, first: true });
    await pad(2);
    expect(h.bridge.tracker.gesture()).toBe('twist');
    await pad(3);
    expect(menuScreen()).toBe('waves');
    expect(h.bridge.tracker.gesture()).toBe('wiper');
    expect(routes.controls).not.toHaveBeenCalled();
    expect(logged('skyline_invaders.controls.closed')).toHaveLength(1);
  });

  it('the controls intro is driven by the keys too: arrows turn the card, accept picks, back leaves', async () => {
    await mount();
    await status('detecting');
    await key('Enter');
    expect(menuScreen()).toBe('controls');
    await key('ArrowRight');
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Twist');
    await key('ArrowLeft');
    expect(screen.getByTestId('invaders-controls-name').textContent).toBe('Wipers');
    await key('Escape');
    expect(menuScreen()).toBe('waves');
    await key('Enter');
    await key('ArrowRight');
    await key('Enter');
    await flush();
    expect(JSON.parse(routes.controls.mock.calls[0][1].body)).toEqual({ gesture: 'twist' });
    expect(padLabels()).toEqual(['Previous', 'Next', 'Change defender', 'Start', 'Controls']);
    await key('ArrowUp');                         // up is Controls on the wave list
    expect(menuScreen()).toBe('controls');
  });

  it('Ready offers Skip only with a gamepad connected', async () => {
    gamepads([{ axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) }]);
    await mount({ controls: { gesture: 'wiper' } });
    await status('detecting');
    await pad(4);
    expect(padLabels()).toEqual(['Back', 'Skip']);
    await pad(4);
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('countdown');
    gamepads([]);
  });

  it('Ready gives up on a camera that never starts and plays with gamepad aim', async () => {
    await mount();
    await pad(4);
    expect(menuScreen()).toBe('ready');
    await f.seconds(20.1);
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('countdown');
  });

  it('plays with gamepad aim when the camera is denied, and the HUD wears a Gamepad aim badge', async () => {
    await mount();
    await startRound();
    expect(screen.getByTestId('skyline-invaders-hud').textContent).toContain('Gamepad aim');
  });

  it('pauses on the module lifecycle and resumes with it', async () => {
    await mount();
    await startRound();
    await act(async () => h.lifecycle.onPause());
    expect(screen.getByTestId('skyline-invaders-paused')).toBeTruthy();
    expect(logged('skyline_invaders.round.paused')[0]).toMatchObject({ reason: 'lifecycle' });
    const frozen = screen.getByTestId('invaders-time').textContent;
    await f.seconds(3);
    expect(screen.getByTestId('invaders-time').textContent).toBe(frozen);
    await act(async () => h.lifecycle.onResume());
    expect(screen.queryByTestId('skyline-invaders-paused')).toBeNull();
    await f.seconds(2);
    expect(screen.getByTestId('invaders-time').textContent).not.toBe(frozen);
  });

  it('ignores lifecycle resume and session end on a fresh lobby', async () => {
    await mount();
    await act(async () => { h.lifecycle.onResume(); h.lifecycle.onSessionEnd(); });
    await flush();
    expect(menuScreen()).toBe('waves');
    expect(postedRecords(routes)).toHaveLength(0);
  });

  it('does not let a lifecycle resume undo a pause the player asked for', async () => {
    await mount();
    await startRound();
    await key('Escape');
    expect(logged('skyline_invaders.round.paused')[0]).toMatchObject({ reason: 'player' });
    await act(async () => h.lifecycle.onResume());
    expect(screen.getByTestId('skyline-invaders-paused')).toBeTruthy();
    await pad(1);
    expect(screen.queryByTestId('skyline-invaders-paused')).toBeNull();
  });

  it('a round has one touch control, Pause; gamepad Start pauses too; the bike buttons do nothing', async () => {
    const unclaimed = vi.fn(() => () => {});
    h.ctx.selectorInputRouter = { onUnclaimed: unclaimed };
    await mount();
    await startRound();
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Pause']);
    expect(unclaimed).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByTestId('skyline-invaders-pause')); });
    expect(screen.getByTestId('skyline-invaders-paused')).toBeTruthy();
    await pad(1);
    const pressed = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 9 }));
    gamepads([{ axes: [0, 0], buttons: pressed }]);
    await f.frames(2);
    gamepads([]);
    expect(screen.getByTestId('skyline-invaders-paused')).toBeTruthy();
  });

  it('pauses when the page is hidden', async () => {
    await mount();
    await startRound();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    visibility.mockRestore();
    expect(screen.getByTestId('skyline-invaders-paused')).toBeTruthy();
  });

  it('drops a mat step made while paused', async () => {
    await mount();
    await startRound();
    await act(async () => h.lifecycle.onPause());
    await step();
    await act(async () => h.lifecycle.onResume());
    await f.frames(3);
    expect(document.querySelectorAll('[data-shot]')).toHaveLength(0);
  });

  it('logs pose acquired and lost as the tracker changes', async () => {
    await mount();
    await feed(wiperPose(0));
    expect(logged('skyline_invaders.pose.acquired')).toHaveLength(1);
    await f.seconds(1);
    await feed(null);
    expect(logged('skyline_invaders.pose.lost')).toHaveLength(1);
  });

  it('keeps the pose bridge mounted from the lobby onward', async () => {
    await mount();
    expect(h.bridge).toMatchObject({ enabled: true, tracker: expect.any(Object) });
    await startRound();
    expect(h.bridge.enabled).toBe(true);
  });

  it('releases governance and stops the audio on unmount', async () => {
    const view = await mount();
    view.unmount();
    expect(h.ctx.setGovernanceSuspended).toHaveBeenLastCalledWith(false);
    expect(h.audio.stop).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('SkylineInvaders — finishing a round', () => {
  it('saves a passed round, pays the rings once, and announces the achievement only after the save', async () => {
    await mount();
    let release;
    routes.runs.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true, status: 201, json: async () => ({ created: true }) }); }));
    const announced = vi.fn();
    window.addEventListener('game-achievement-recorded', announced);
    await startRound();
    await shootFirstMeteor();
    await f.seconds(30);
    expect(screen.getByTestId('skyline-invaders-result').textContent).toContain('Skyline held!');
    const records = postedRecords(routes);
    expect(records).toHaveLength(1);
    expect(records[0].run).toMatchObject({ status: 'completed', level_id: 'invaders-test', fitness_session_id: 'fs-test', mat_equipment_id: 'step-mat', steps: 1 });
    expect(records[0].run.kills).toBeGreaterThanOrEqual(1);
    expect(records[0].rider.user_id).toBe('kid');
    expect(announced).not.toHaveBeenCalled();
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).not.toHaveBeenCalled();
    await act(async () => release());
    await flush();
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).toHaveBeenCalledTimes(1);
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `invaders:${records[0].run.id}:completion:kid`, userId: 'kid', rings: records[0].run.reward_rings, source: 'skyline-invaders',
    }));
    expect(announced).toHaveBeenCalledTimes(1);
    expect(announced.mock.calls[0][0].detail).toMatchObject({ source: 'skyline-invaders', runId: records[0].run.id });
    expect(screen.getByTestId('skyline-invaders-result').textContent).toContain(`+${records[0].run.reward_rings} rings`);
    expect(logged('skyline_invaders.round.saved')).toHaveLength(1);
    window.removeEventListener('game-achievement-recorded', announced);
  });

  it('saves a round that fell short as failed and pays nothing', async () => {
    await mount();
    await startRound();
    await f.seconds(30.5);
    await flush();
    expect(postedRecords(routes).map((record) => record.run.status)).toEqual(['failed']);
    expect(screen.getByTestId('skyline-invaders-result').textContent).toContain('Skyline fell short');
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).not.toHaveBeenCalled();
    expect(logged('skyline_invaders.level.end')[0]).toMatchObject({ status: 'failed', score: 0, stars: 0, kills: 0, baseHp: expect.any(Number), levelId: 'invaders-test', runId: expect.any(String) });
  });

  it('saves a round ended from the pause screen as abandoned', async () => {
    await mount();
    await startRound();
    await f.seconds(2);
    await key('Escape');
    await pad(3);
    await flush();
    expect(postedRecords(routes).map((record) => record.run.status)).toEqual(['abandoned']);
    expect(screen.getByTestId('skyline-invaders-result').textContent).toContain('Round ended');
  });

  it('abandons the round when the fitness session ends', async () => {
    await mount();
    await startRound();
    await f.seconds(1);
    await act(async () => h.lifecycle.onSessionEnd());
    await flush();
    expect(postedRecords(routes).map((record) => record.run.status)).toEqual(['abandoned']);
  });

  it('offers Retry save after a failed save, re-posts the same record, and pays once', async () => {
    await mount();
    routes.runs.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await startRound();
    await shootFirstMeteor();
    await f.seconds(30);
    await flush();
    expect(screen.getByRole('alert').textContent).toMatch(/not saved/i);
    expect(logged('skyline_invaders.round.save_error', 'error')).toHaveLength(1);
    expect(padLabels()).toEqual(['Retry save']);
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).not.toHaveBeenCalled();
    await pad(1);
    await flush();
    const records = postedRecords(routes);
    expect(records).toHaveLength(2);
    expect(records[1]).toEqual(records[0]);
    expect(h.ctx.fitnessSessionInstance.treasureBox.awardBonus).toHaveBeenCalledTimes(1);
    expect(padLabels()[0]).toBe('Replay');
  });

  it('plays again with a new run (a stomp replays a saved round), and returns to the waves', async () => {
    await mount();
    await startRound();
    await f.seconds(30.5);
    await flush();
    expect(padLabels()).toEqual(['Replay', 'Waves', 'Change defender']);
    await step('mat-a1', 'pressure-mat:stomp');
    await f.seconds(3.1);
    expect(screen.getByTestId('skyline-invaders-play').getAttribute('data-phase')).toBe('playing');
    const starts = logged('skyline_invaders.level.start');
    expect(starts).toHaveLength(2);
    expect(starts[1].runId).not.toBe(starts[0].runId);
    expect(screen.getByTestId('invaders-time').textContent).toBe('0:30');
    await f.seconds(30.5);
    await flush();
    await pad(3);
    expect(menuScreen()).toBe('waves');
  });

  it('shows the stars and the round numbers on the result', async () => {
    await mount();
    await startRound();
    await shootFirstMeteor();
    await f.seconds(30);
    await flush();
    const result = within(screen.getByTestId('skyline-invaders-result'));
    expect(result.getByLabelText(/of 3 stars/)).toBeTruthy();
    for (const label of ['Shot down', 'Score', 'Best streak', 'Skyline']) expect(result.getByText(label)).toBeTruthy();
  });
});

describe('SkylineInvaders — school-day access and level unlocks', () => {
  it('shows the lock screen to a school learner without the entitlement, who cannot start', async () => {
    h.localDev = false;
    h.entitlement = entitlement('denied');
    await mount();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
    expect(button(/Admin unlock/)).toBeTruthy();
    await key('Escape');
    await key('Enter');
    await f.seconds(4);
    expect(screen.queryByTestId('skyline-invaders-play')?.getAttribute('data-phase')).not.toBe('playing');
    expect(logged('skyline_invaders.level.start')).toHaveLength(0);
  });

  it('lets a matched admin open the game while the shooter stays the rider on the record', async () => {
    h.localDev = false;
    h.entitlement = entitlement('denied');
    h.registerAdmin = vi.fn(async () => ({ matched: true, userId: 'test-rider' }));
    await mount();
    await press(/Admin unlock/);
    await flush();
    expect(h.registerAdmin).toHaveBeenCalledWith('skyline_invaders');
    expect(logged('skyline_invaders.access.override_granted')[0]).toMatchObject({ riderId: 'kid', adminUserId: 'test-rider' });
    await startRound();
    await f.seconds(30.5);
    await flush();
    expect(postedRecords(routes)[0].rider.user_id).toBe('kid');
  });

  it('keeps the game locked when the admin check is denied', async () => {
    h.localDev = false;
    h.entitlement = entitlement('denied');
    await mount();
    await press(/Admin unlock/);
    await flush();
    expect(logged('skyline_invaders.access.override_denied')).toHaveLength(1);
    // The prompt shows the denial until it is cancelled (3); the lock stays.
    expect(padLabels()).toEqual(['Cancel']);
    await pad(3);
    expect(button(/Admin unlock/)).toBeTruthy();
  });

  it('ends the round and returns to the lobby when access is revoked mid-round', async () => {
    h.localDev = false;
    h.entitlement = entitlement('granted');
    await mount();
    await startRound();
    h.entitlement = entitlement('denied');
    await act(async () => { vi.advanceTimersByTime(16_000); });
    await flush();
    expect(postedRecords(routes).map((record) => record.run.status)).toEqual(['abandoned']);
    expect(screen.getByTestId('skyline-invaders-locked')).toBeTruthy();
  });

  it('unlocks a locked level through an admin and then offers it', async () => {
    const levels = [testLevel(), testLevel({ id: 'invaders-test-2', name: 'Second Wave' })];
    const worldOf = (second) => ({ riderId: 'kid', next: 'invaders-test', levels: [{ id: 'invaders-test', name: 'Test Wave', status: 'open' }, { id: 'invaders-test-2', name: 'Second Wave', status: second }] });
    h.registerAdmin = vi.fn(async () => ({ matched: true, userId: 'test-rider' }));
    await mount({ levels, world: worldOf('locked') });
    expect(button(/Second Wave/).getAttribute('data-status')).toBe('locked');
    routes.world.mockImplementation(async () => ({ ok: true, status: 200, json: async () => worldOf('open') }));
    await press(/Second Wave/);
    expect(padLabels()[3]).toBe('Locked');
    await pad(4);
    await flush();
    const [url, options] = routes.unlock.mock.calls[0];
    expect(String(url)).toContain('/skyline-invaders/progress/kid/unlock');
    expect(JSON.parse(options.body)).toEqual({ levelId: 'invaders-test-2', unlockedBy: 'test-rider' });
    expect(button(/Second Wave/).getAttribute('aria-pressed')).toBe('true');
  });

  // 2026-11-12 (Fable review): the shooter list offered every household member,
  // so a child could pick a grown-up (not a learner) and play past the school
  // gate. The gate follows who is riding, never the pick.
  describe('the gate follows the workout, not the pick', () => {
    const learners = (id) => ({ id, schoolLearner: id === 'kid' });
    it('picking a grown-up does not open a round while a child with school left is riding', async () => {
      h.localDev = false;
      h.entitlement = entitlement('denied', 'kid');
      h.ctx.participantRoster = [{ id: 'kid', name: 'Kid' }];
      h.ctx.getUserByName = learners;
      await mount();
      expect(screen.getByTestId('skyline-invaders-locked')).toBeTruthy();
      await pad(4);
      // Only the people in the workout are offered; the grown-up is behind Someone else.
      expect(tileNames()).toEqual(['Kid', 'Someone else']);
      await tapPerson('Someone else');
      expect(screen.getByTestId('skyline-invaders-roster').textContent).toContain('Test Rider');
      await tapPerson('Test Rider');
      await flush();
      expect(screen.getByTestId('skyline-invaders').getAttribute('data-shooter-id')).toBe('test-rider');
      expect(screen.getByTestId('skyline-invaders-locked')).toBeTruthy();
      expect(screen.getByTestId('invaders-locked-for').textContent).toContain('Kid');
      expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
      await key('Enter');
      await f.seconds(4);
      expect(logged('skyline_invaders.level.start')).toHaveLength(0);
    });

    it('a grown-up with no learner riding plays without a lock', async () => {
      h.localDev = false;
      h.entitlement = entitlement('denied', 'kid');
      h.ctx = makeCtx({ matRider: null });
      h.ctx.participantRoster = [{ id: 'test-rider', name: 'Test Rider' }];
      h.ctx.getUserByName = learners;
      await mount();
      expect(tileNames()[0]).toBe('Test Rider');
      await tapPerson('Test Rider');
      await flush();
      expect(screen.queryByTestId('skyline-invaders-locked')).toBeNull();
      await startRound();
    });

    it('the lock screen is the only thing on screen: no level cards behind it', async () => {
      h.localDev = false;
      h.entitlement = entitlement('denied', 'kid');
      await mount();
      const locked = screen.getByTestId('skyline-invaders-locked');
      expect(within(locked).getByRole('heading', { name: 'Round locked' })).toBeTruthy();
      expect(locked.textContent).toContain('Finish today’s school work to unlock.');
      expect(screen.queryByTestId('skyline-invaders-lobby')).toBeNull();
      expect(document.querySelectorAll('[data-level]')).toHaveLength(0);
      expect(padLabels()).toEqual(['Admin unlock', 'Back', 'Change defender']);
      expect(screen.queryByTestId('skyline-invaders-waves')).toBeNull();
      await pad(3);
      expect(menuScreen()).toBe('who');
    });
  });

  it('treats every level as open when the world map cannot be read', async () => {
    await mount({ levels: [testLevel(), testLevel({ id: 'invaders-test-2', name: 'Second Wave' })] });
    expect(logged('skyline_invaders.world.error', 'warn')).toHaveLength(1);
    expect(button(/Second Wave/).getAttribute('data-status')).toBe('open');
  });
});
