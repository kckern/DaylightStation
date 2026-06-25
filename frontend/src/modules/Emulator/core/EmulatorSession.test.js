import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEmulatorSession } from './EmulatorSession.js';
import { createBindingMatcher } from './BindingMatcher.js';

// --- Fakes -----------------------------------------------------------------

function makeEngine(overrides = {}) {
  return {
    boot: vi.fn(async () => {}),
    isReady: vi.fn(() => true),
    pause: vi.fn(),
    resume: vi.fn(),
    setVolume: vi.fn(),
    getHeap: vi.fn(() => new Uint8Array(0x2000)),
    setCheat: vi.fn(),
    resetCheat: vi.fn(),
    waitFrames: vi.fn(async () => {}),
    destroy: vi.fn(),
    ...overrides,
  };
}

function makeMixer(overrides = {}) {
  return {
    playMusic: vi.fn(),
    playCue: vi.fn(),
    stopMusic: vi.fn(),
    setBusVolume: vi.fn(),
    muteBus: vi.fn(),
    ...overrides,
  };
}

function makeGate({ playable = true } = {}) {
  let cb = null;
  return {
    mode: 'open',
    _state: { playable },
    isPlayable: vi.fn(function () {
      return this._state.playable;
    }),
    getStatus: vi.fn(() => ({})),
    onChange: vi.fn((fn) => {
      cb = fn;
      return vi.fn(); // unsub
    }),
    fire() {
      cb && cb();
    },
  };
}

function makeScheduler() {
  let fn = null;
  return {
    set: vi.fn((f) => {
      fn = f;
      return 1;
    }),
    clear: vi.fn(),
    tick() {
      fn && fn();
    },
  };
}

const GAME = {
  id: 'pokemon-red',
  system: 'gb',
  romUrl: 'apps/fitness/roms/red.gb',
  states: {
    battle: { addr: 0xd057, type: 'enum', values: { 0: 'none', 1: 'wild', 2: 'trainer' } },
  },
  bindings: [
    {
      on: 'battle == trainer',
      do: {
        music: { url: 'apps/fitness/music/battle.mp3', loop: true },
        governance: { required_zone: 'hot' },
      },
    },
    { on: 'battle == none', do: { music: { url: 'apps/fitness/music/route.mp3' } } },
  ],
};

const ENGINE_CONFIG = { pathtodata: '/data/emu', core: 'gb' };

function setup(opts = {}) {
  const engine = opts.engine || makeEngine();
  const mixer = opts.mixer || makeMixer();
  const governanceGate = opts.gate || makeGate();
  const scheduler = opts.scheduler || makeScheduler();
  const actionHandlers = opts.actionHandlers || {
    haScene: vi.fn(),
    animation: vi.fn(),
    governance: vi.fn(),
    toast: vi.fn(),
  };
  const resolveMediaUrl = opts.resolveMediaUrl || ((p) => `https://cdn/${p}`);

  // Default fake deps factories; allow overrides.
  const capture = { onState: null, stateMap: null };
  const deps = {
    createWramCalibrator:
      opts.createWramCalibrator ||
      (() => ({ calibrate: vi.fn(async () => ({ wramBase: 0 })) })),
    createStateMap:
      opts.createStateMap ||
      ((args) => {
        capture.onState = args.onState;
        capture.stateMap = {
          start: vi.fn(),
          stop: vi.fn(),
          sample: vi.fn(),
          getState: vi.fn(() => ({ battle: 'none' })),
        };
        return capture.stateMap;
      }),
    createBindingMatcher: opts.createBindingMatcher || createBindingMatcher,
    resolveMediaUrl,
    ...(opts.deps || {}),
  };

  const session = createEmulatorSession({
    engine,
    mixer,
    governanceGate,
    game: opts.game || GAME,
    engineConfig: ENGINE_CONFIG,
    actionHandlers,
    deps,
    scheduler,
  });

  return { session, engine, mixer, governanceGate, scheduler, actionHandlers, resolveMediaUrl, deps, capture };
}

// --- Tests -----------------------------------------------------------------

describe('createEmulatorSession.start', () => {
  it('boots the engine with the right args', async () => {
    const { session, engine } = setup();
    const mount = {};
    await session.start({ mount });
    expect(engine.boot).toHaveBeenCalledWith({
      mount,
      romUrl: GAME.romUrl,
      pathtodata: ENGINE_CONFIG.pathtodata,
      core: ENGINE_CONFIG.core,
    });
  });

  it('falls back to game.system for core when engineConfig.core absent', async () => {
    const engine = makeEngine();
    const { session } = setup({ engine });
    // override engineConfig via fresh session
    const s = createEmulatorSession({
      engine,
      mixer: makeMixer(),
      governanceGate: makeGate(),
      game: GAME,
      engineConfig: { pathtodata: '/x' },
      scheduler: makeScheduler(),
      deps: {
        createWramCalibrator: () => ({ calibrate: async () => null }),
      },
    });
    await s.start({ mount: {} });
    expect(engine.boot).toHaveBeenCalledWith(
      expect.objectContaining({ core: 'gb' }),
    );
  });

  it('calibrates, and on success with states creates+starts a stateMap', async () => {
    const calibrate = vi.fn(async () => ({ wramBase: 42 }));
    const createWramCalibrator = vi.fn(() => ({ calibrate }));
    const { session, capture } = setup({ createWramCalibrator });
    await session.start({ mount: {} });
    expect(calibrate).toHaveBeenCalled();
    expect(session.getWramBase()).toBe(42);
    expect(capture.stateMap.start).toHaveBeenCalled();
  });

  it('passes engine I/O fns to the calibrator', async () => {
    const engine = makeEngine();
    const createWramCalibrator = vi.fn(() => ({ calibrate: async () => ({ wramBase: 0 }) }));
    const { session } = setup({ engine, createWramCalibrator });
    await session.start({ mount: {} });
    const passed = createWramCalibrator.mock.calls[0][0];
    expect(passed.setCheat).toBe(engine.setCheat);
    expect(passed.resetCheat).toBe(engine.resetCheat);
    expect(passed.getHeap).toBe(engine.getHeap);
    expect(passed.waitFrames).toBe(engine.waitFrames);
    expect(passed.system).toBe('gb');
  });

  it('calibration null → no stateMap, warns, engine still booted (playable)', async () => {
    const createStateMap = vi.fn();
    const { session, engine } = setup({
      createWramCalibrator: () => ({ calibrate: async () => null }),
      createStateMap,
    });
    await session.start({ mount: {} });
    expect(engine.boot).toHaveBeenCalled();
    expect(createStateMap).not.toHaveBeenCalled();
    expect(session.getWramBase()).toBeNull();
    // game still playable: gate is playable → resume
    expect(engine.resume).toHaveBeenCalled();
  });

  it('no states on game → skip state layer even if calibration succeeds', async () => {
    const createStateMap = vi.fn();
    const game = { ...GAME, states: undefined };
    const { session } = setup({ game, createStateMap });
    await session.start({ mount: {} });
    expect(createStateMap).not.toHaveBeenCalled();
  });
});

describe('binding dispatch wiring (real BindingMatcher)', () => {
  it('state change "battle == trainer" fires music + governance bindings', async () => {
    const { session, mixer, actionHandlers, capture, resolveMediaUrl } = setup();
    await session.start({ mount: {} });
    // simulate StateMap firing onState
    capture.onState('battle', { type: 'enum', value: 'trainer', raw: 2 });

    expect(mixer.playMusic).toHaveBeenCalledWith(
      resolveMediaUrl('apps/fitness/music/battle.mp3'),
      { loop: true },
    );
    expect(actionHandlers.governance).toHaveBeenCalledWith(
      { required_zone: 'hot' },
      expect.objectContaining({ state: 'battle' }),
    );
  });

  it('music handler applies resolveMediaUrl and defaults loop true', async () => {
    const { session, mixer, capture, resolveMediaUrl } = setup();
    await session.start({ mount: {} });
    capture.onState('battle', { type: 'enum', value: 'none', raw: 0 });
    expect(mixer.playMusic).toHaveBeenCalledWith(
      resolveMediaUrl('apps/fitness/music/route.mp3'),
      { loop: true },
    );
  });

  it('chime handler routes to mixer.playCue with resolveMediaUrl', async () => {
    const game = {
      ...GAME,
      bindings: [{ on: 'battle == wild', do: { chime: 'apps/fitness/sfx/ding.wav' } }],
    };
    const { session, mixer, capture, resolveMediaUrl } = setup({ game });
    await session.start({ mount: {} });
    capture.onState('battle', { type: 'enum', value: 'wild', raw: 1 });
    expect(mixer.playCue).toHaveBeenCalledWith(resolveMediaUrl('apps/fitness/sfx/ding.wav'));
  });
});

describe('end-to-end: real StateMap + real BindingMatcher', () => {
  it('battle==trainer in WRAM fires music + governance', async () => {
    // real heap; battle addr 0xd057 → wramBase 0 means offset 0x1057
    const heap = new Uint8Array(0x2000);
    const engine = makeEngine({ getHeap: () => heap });
    const mixer = makeMixer();
    const governance = vi.fn();

    // Use the REAL StateMap and REAL BindingMatcher.
    const { createStateMap } = await import('./StateMap.js');

    const scheduler = makeScheduler();
    const session = createEmulatorSession({
      engine,
      mixer,
      governanceGate: makeGate(),
      game: GAME,
      engineConfig: ENGINE_CONFIG,
      actionHandlers: { governance },
      scheduler,
      deps: {
        createWramCalibrator: () => ({ calibrate: async () => ({ wramBase: 0 }) }),
        createStateMap, // real
        createBindingMatcher, // real
        resolveMediaUrl: (p) => p,
      },
    });

    await session.start({ mount: {} });
    // Drive the real StateMap synchronously via getGameState path: call sample.
    heap[0x1057] = 2; // trainer
    session._stateMapForTest.sample();

    expect(mixer.playMusic).toHaveBeenCalledWith('apps/fitness/music/battle.mp3', { loop: true });
    expect(governance).toHaveBeenCalledWith(
      { required_zone: 'hot' },
      expect.objectContaining({ state: 'battle' }),
    );
  });
});

describe('governance enforcement', () => {
  it('gate not playable at start → engine.pause()', async () => {
    const gate = makeGate({ playable: false });
    const { session, engine } = setup({ gate });
    await session.start({ mount: {} });
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.resume).not.toHaveBeenCalled();
  });

  it('flip playable via onChange → engine.resume(); tracks flips (no redundant calls)', async () => {
    const gate = makeGate({ playable: false });
    const { session, engine } = setup({ gate });
    await session.start({ mount: {} });
    expect(engine.pause).toHaveBeenCalledTimes(1);

    gate._state.playable = true;
    gate.fire();
    expect(engine.resume).toHaveBeenCalledTimes(1);

    // fire again, no state change → no redundant resume
    gate.fire();
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(engine.pause).toHaveBeenCalledTimes(1);
  });

  it('subscribes to onChange and registers scheduler poll', async () => {
    const gate = makeGate();
    const scheduler = makeScheduler();
    const { session } = setup({ gate, scheduler });
    await session.start({ mount: {} });
    expect(gate.onChange).toHaveBeenCalledTimes(1);
    expect(scheduler.set).toHaveBeenCalledTimes(1);
  });

  it('scheduler poll triggers applyGate (credit depletion without onChange)', async () => {
    const gate = makeGate({ playable: true });
    const scheduler = makeScheduler();
    const { session, engine } = setup({ gate, scheduler });
    await session.start({ mount: {} });
    expect(engine.resume).toHaveBeenCalledTimes(1); // initial

    // playability drops with NO onChange event
    gate._state.playable = false;
    scheduler.tick();
    expect(engine.pause).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  let session, engine, mixer, scheduler, gate, capture, unsub;
  beforeEach(async () => {
    unsub = vi.fn();
    gate = makeGate();
    gate.onChange = vi.fn(() => unsub);
    const s = setup({ gate });
    session = s.session;
    engine = s.engine;
    mixer = s.mixer;
    scheduler = s.scheduler;
    capture = s.capture;
    await session.start({ mount: {} });
  });

  it('stop() unsubscribes onChange, stops stateMap, stops music, clears poll', () => {
    session.stop();
    expect(unsub).toHaveBeenCalled();
    expect(capture.stateMap.stop).toHaveBeenCalled();
    expect(mixer.stopMusic).toHaveBeenCalled();
    expect(scheduler.clear).toHaveBeenCalled();
  });

  it('destroy() stops then destroys engine', () => {
    session.destroy();
    expect(mixer.stopMusic).toHaveBeenCalled();
    expect(engine.destroy).toHaveBeenCalled();
  });

  it('getGameState() returns stateMap.getState() or {} when no map', () => {
    expect(session.getGameState()).toEqual({ battle: 'none' });
  });
});

describe('getGameState without state layer', () => {
  it('returns {} when calibration failed', async () => {
    const { session } = setup({
      createWramCalibrator: () => ({ calibrate: async () => null }),
    });
    await session.start({ mount: {} });
    expect(session.getGameState()).toEqual({});
  });
});

describe('runActions (hotspot do: blocks reuse the binding handler map)', () => {
  it('dispatches each action through the same handlers bindings use', () => {
    const { session, mixer, actionHandlers, resolveMediaUrl } = setup();
    session.runActions(
      { chime: 'apps/fitness/emu/coin.mp3', toast: 'Credit: 8' },
      { hotspot: 'battery_led' },
    );
    expect(mixer.playCue).toHaveBeenCalledWith(resolveMediaUrl('apps/fitness/emu/coin.mp3'));
    expect(actionHandlers.toast).toHaveBeenCalledWith('Credit: 8', { hotspot: 'battery_led' });
  });

  it('is tolerant of an empty/missing do map', () => {
    const { session } = setup();
    expect(() => session.runActions()).not.toThrow();
    expect(() => session.runActions({})).not.toThrow();
  });
});
