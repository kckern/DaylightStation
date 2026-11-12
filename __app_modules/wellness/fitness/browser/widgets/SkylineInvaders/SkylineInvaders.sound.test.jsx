// The game's own volume and the Sound sheet, through the real shell and the
// real fitness volume store (VolumeProvider over an in-memory storage). Only
// the edges are faked: audio, pose bridge, identity, the bike-button router's
// wire (the router itself is real).
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
import { VolumeProvider } from '../../nav/VolumeProvider.jsx';
import { createSelectorInputRouter } from '../../lib/selectorInputRouter.js';
import { flush, installFrames, makeCtx, routeFetch } from './invadersTestKit.js';

const GAME_KEY = 'volume:fitness:fitness-game-skyline-invaders:global:game';
const memoryStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() { return data.size; },
    data,
  };
};

let f;
let storage;
const press = (name) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
const keyDown = (key) => act(async () => { fireEvent.keyDown(window, { key }); });
const bike = (action) => {
  let consumed;
  act(() => { consumed = h.ctx.selectorInputRouter.route({ selectorId: 'pad', equipmentId: 'bike', action, userId: 'test-rider' }); });
  return consumed;
};
const phase = () => document.querySelector('[data-phase]').getAttribute('data-phase');
const sheet = () => screen.queryByTestId('skyline-invaders-sound');
const readout = () => screen.getByTestId('skyline-invaders-sound-readout').textContent;
const lastOutput = () => h.audio.setVolume.mock.calls.at(-1)[0];
const logged = (name) => h.log.info.mock.calls.filter(([event]) => event === name).map(([, data]) => data);

async function mount(seed = {}) {
  f = installFrames();
  routeFetch();
  storage = memoryStorage(seed);
  render(<VolumeProvider storage={storage}><SkylineInvaders /></VolumeProvider>);
  await flush();
}
async function start() {
  await press(/^Start/);
  await f.seconds(3.1);
  expect(phase()).toBe('playing');
}

beforeEach(() => {
  Object.values(h.log).forEach((fn) => fn.mockClear());
  h.ctx = makeCtx();
  h.ctx.selectorInputRouter = createSelectorInputRouter();
  h.ctx.riderSelectors = [{ id: 'pad', equipment: 'bike', buttons: { '1_single': 'test-rider' } }];
  h.bridge = null;
  h.audio = {
    loadSounds: vi.fn(async () => ({ loaded: [], missing: [] })), prime: vi.fn(async () => true), playCue: vi.fn(() => true),
    setMuted: vi.fn(), setVolume: vi.fn(), getLevels: vi.fn(() => ({ output: h.audio.setVolume.mock.calls.at(-1)?.[0] ?? 1 })), stop: vi.fn(),
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Skyline Invaders — game volume', () => {
  it('plays at its own audible default, never at full gain and never at the video level', async () => {
    await mount({ 'volume:fitness:fitness:global:video': JSON.stringify({ level: 0.1, muted: false }) });
    expect(h.audio.setVolume).toHaveBeenCalled();
    expect(lastOutput()).toBeCloseTo(0.158, 2);          // level 60 on the house curve
    expect(logged('skyline_invaders.audio.volume').at(-1)).toMatchObject({ level: 60, muted: false, isDefault: true });
  });

  it('a stored level is the output gain (curve applied once)', async () => {
    await mount({ [GAME_KEY]: JSON.stringify({ level: 0.1, muted: false }) });
    expect(lastOutput()).toBeCloseTo(0.1, 5);
  });
});

describe('Skyline Invaders — the Sound sheet by touch', () => {
  it('opens from the lobby "more" button, sets the level, mutes, and goes back', async () => {
    await mount();
    await press('Sound and settings');
    expect(sheet()).not.toBeNull();
    expect(phase()).toBe('lobby');
    expect(readout()).toBe('Volume 60');
    expect(sheet().querySelector('input[type="range"]')).toBeNull();
    const keys = sheet().querySelectorAll('.touch-volume-button');
    expect(keys).toHaveLength(11);
    await act(async () => { fireEvent.click(keys[8], { detail: 0 }); });
    expect(readout()).toBe('Volume 80');
    expect(lastOutput()).toBeCloseTo(0.398, 2);
    expect(JSON.parse(storage.data.get(GAME_KEY)).level).toBeCloseTo(0.398, 2);
    await press(/^Mute Bike/);
    expect(readout()).toBe('Muted');
    expect(lastOutput()).toBe(0);
    await press(/^Unmute Bike/);
    expect(lastOutput()).toBeCloseTo(0.398, 2);
    await press(/^Back/);
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('skyline-invaders-lobby')).toBeTruthy();
  });

  it('mid-round the "more" button pauses first; Back lands on the pause screen', async () => {
    await mount();
    await start();
    await press('Sound and settings');
    expect(phase()).toBe('paused');
    expect(sheet()).not.toBeNull();
    expect(logged('skyline_invaders.round.paused').at(-1)).toMatchObject({ reason: 'player' });
    await press(/^Back/);
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('skyline-invaders-pause')).toBeTruthy();
    expect(phase()).toBe('paused');
  });

  it('the pause screen offers Sound', async () => {
    await mount();
    await start();
    await press('Pause');
    await press(/^Sound Bike/);
    expect(sheet()).not.toBeNull();
  });

  it('a workout resume does not restart the round under the open sheet', async () => {
    await mount();
    await start();
    act(() => h.lifecycle.onPause());
    expect(phase()).toBe('paused');
    await press('Sound and settings');
    act(() => h.lifecycle.onResume());
    expect(phase()).toBe('paused');
    expect(sheet()).not.toBeNull();
  });
});

describe('Skyline Invaders — the Sound sheet by bike buttons', () => {
  it('hold 4 pauses, 2 opens Sound, 1 quieter, 2 louder, 4 mute, 3 back, then 1 resumes', async () => {
    await mount();
    await start();
    expect(bike('4_hold')).toBe(true);
    expect(phase()).toBe('paused');
    expect(bike('2_single')).toBe(true);
    expect(sheet()).not.toBeNull();
    bike('1_single');
    expect(readout()).toBe('Volume 50');
    bike('2_single'); bike('2_single');
    expect(readout()).toBe('Volume 70');
    bike('4_single');
    expect(readout()).toBe('Muted');
    expect(lastOutput()).toBe(0);
    bike('4_single');
    expect(readout()).toBe('Volume 70');
    bike('3_single');
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('skyline-invaders-pause')).toBeTruthy();
    bike('1_single');
    expect(phase()).toBe('playing');
    expect(logged('skyline_invaders.audio.level_set').map((d) => d.control)).toContain('bike');
  });

  it('in the lobby the bike buttons stay with rider selection (not swallowed)', async () => {
    await mount();
    expect(bike('2_single')).toBe(false);
  });

  it('mid-round a single press is not taken: only a hold of 4 pauses', async () => {
    await mount();
    await start();
    expect(bike('1_single')).toBe(false);
    expect(phase()).toBe('playing');
  });
});

describe('Skyline Invaders — the Sound sheet by keys, foot pad and gamepad', () => {
  it('Back has the focus; right moves to Quieter; Enter presses it; Escape closes', async () => {
    await mount();
    await press('Sound and settings');
    await keyDown('ArrowRight');
    await keyDown('Enter');
    expect(readout()).toBe('Volume 50');
    await keyDown('Escape');
    expect(sheet()).toBeNull();
    expect(screen.getByTestId('skyline-invaders-lobby')).toBeTruthy();
  });

  it('the lobby does not act on keys while the sheet is open', async () => {
    await mount();
    await press('Sound and settings');
    await keyDown('Enter');      // Back, not Start
    expect(phase()).toBe('lobby');
    expect(sheet()).toBeNull();
  });
});
