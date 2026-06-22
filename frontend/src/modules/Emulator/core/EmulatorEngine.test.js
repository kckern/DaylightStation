import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmulatorEngine } from './EmulatorEngine.js';

function makeFakeInstance(overrides = {}) {
  const heap = new Uint8Array(16);
  return {
    pause: vi.fn(),
    play: vi.fn(),
    setVolume: vi.fn(),
    gameManager: {
      Module: { HEAPU8: heap },
      functions: {
        setCheat: vi.fn(),
        resetCheat: vi.fn(),
        getFrameNum: vi.fn(() => 0),
      },
    },
    ...overrides,
  };
}

function makeFakeWin() {
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); },
  };
  const doc = {
    _byId: {},
    getElementById(id) { return this._byId[id] || null; },
    head,
  };
  return {
    document: doc,
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
  };
}

describe('EmulatorEngine boot', () => {
  it('boots, resolves and becomes ready', async () => {
    const instance = makeFakeInstance();
    const load = vi.fn(async (args) => {
      expect(args.player).toBe('#mount');
      expect(args.core).toBe('gb');
      expect(args.romUrl).toBe('rom');
      expect(args.pathtodata).toBe('data/');
      return instance;
    });
    const engine = createEmulatorEngine({ load, win: makeFakeWin() });
    expect(engine.isReady()).toBe(false);
    await engine.boot({ mount: '#mount', romUrl: 'rom', pathtodata: 'data/' });
    expect(engine.isReady()).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: second boot does not re-load', async () => {
    const instance = makeFakeInstance();
    const load = vi.fn(async () => instance);
    const engine = createEmulatorEngine({ load, win: makeFakeWin() });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });
    expect(load).toHaveBeenCalledTimes(1);
    expect(engine.isReady()).toBe(true);
  });

  it('passes an element mount through as player', async () => {
    const instance = makeFakeInstance();
    const el = { nodeType: 1 };
    const load = vi.fn(async (args) => { expect(args.player).toBe(el); return instance; });
    const engine = createEmulatorEngine({ load, win: makeFakeWin() });
    await engine.boot({ mount: el, romUrl: 'r', pathtodata: 'd/' });
    expect(load).toHaveBeenCalled();
  });
});

describe('EmulatorEngine controls', () => {
  let instance, engine;
  beforeEach(async () => {
    instance = makeFakeInstance();
    engine = createEmulatorEngine({ load: async () => instance, win: makeFakeWin() });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });
  });

  it('pause/resume delegate to instance', () => {
    engine.pause();
    expect(instance.pause).toHaveBeenCalledTimes(1);
    engine.resume();
    expect(instance.play).toHaveBeenCalledTimes(1);
  });

  it('setVolume clamps to 0..1', () => {
    engine.setVolume(0.5);
    expect(instance.setVolume).toHaveBeenLastCalledWith(0.5);
    engine.setVolume(2);
    expect(instance.setVolume).toHaveBeenLastCalledWith(1);
    engine.setVolume(-3);
    expect(instance.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('getHeap returns the live HEAPU8', () => {
    expect(engine.getHeap()).toBe(instance.gameManager.Module.HEAPU8);
  });

  it('setCheat / resetCheat delegate to gameManager.functions', () => {
    engine.setCheat(3, true, 'AB-CD');
    expect(instance.gameManager.functions.setCheat).toHaveBeenCalledWith(3, true, 'AB-CD');
    engine.resetCheat();
    expect(instance.gameManager.functions.resetCheat).toHaveBeenCalledTimes(1);
  });

  it('getFrameNum delegates', () => {
    instance.gameManager.functions.getFrameNum.mockReturnValue(42);
    expect(engine.getFrameNum()).toBe(42);
  });
});

describe('EmulatorEngine guards when not ready', () => {
  it('control methods are safe no-ops; accessors return null', () => {
    const engine = createEmulatorEngine({ load: async () => makeFakeInstance(), win: makeFakeWin() });
    expect(() => engine.pause()).not.toThrow();
    expect(() => engine.resume()).not.toThrow();
    expect(() => engine.setVolume(0.5)).not.toThrow();
    expect(() => engine.setCheat(0, true, 'x')).not.toThrow();
    expect(() => engine.resetCheat()).not.toThrow();
    expect(engine.getHeap()).toBeNull();
    expect(engine.getFrameNum()).toBeNull();
    expect(engine.isReady()).toBe(false);
  });
});

describe('EmulatorEngine waitFrames', () => {
  afterEach(() => vi.useRealTimers());

  it('resolves once the frame counter advances by >= n', async () => {
    vi.useFakeTimers();
    let frame = 100;
    const instance = makeFakeInstance();
    instance.gameManager.functions.getFrameNum = () => frame;
    const engine = createEmulatorEngine({ load: async () => instance, win: makeFakeWin() });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });

    const p = engine.waitFrames(70);
    let resolved = false;
    p.then(() => { resolved = true; });

    // Not enough frames yet.
    frame = 150;
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(false);

    // Cross the threshold (>= 100 + 70).
    frame = 175;
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect(resolved).toBe(true);
  });

  it('falls back to a time-based delay when getFrameNum is unavailable', async () => {
    vi.useFakeTimers();
    const instance = makeFakeInstance();
    delete instance.gameManager.functions.getFrameNum;
    const engine = createEmulatorEngine({ load: async () => instance, win: makeFakeWin() });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });

    const p = engine.waitFrames(10);
    let resolved = false;
    p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(10 * 16 + 5);
    await p;
    expect(resolved).toBe(true);
  });

  it('caps total wait at ~3s even if frames never advance', async () => {
    vi.useFakeTimers();
    const instance = makeFakeInstance();
    instance.gameManager.functions.getFrameNum = () => 100; // never advances
    const engine = createEmulatorEngine({ load: async () => instance, win: makeFakeWin() });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });

    const p = engine.waitFrames(70);
    let resolved = false;
    p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(3100);
    await p;
    expect(resolved).toBe(true);
  });
});

describe('EmulatorEngine destroy', () => {
  it('pauses, removes the loader script, and clears readiness', async () => {
    const instance = makeFakeInstance();
    const win = makeFakeWin();
    // Simulate an injected loader script in the DOM.
    const script = { id: 'ejs-loader', remove: vi.fn() };
    win.document._byId['ejs-loader'] = script;

    const engine = createEmulatorEngine({ load: async () => instance, win });
    await engine.boot({ mount: '#m', romUrl: 'r', pathtodata: 'd/' });
    engine.destroy();

    expect(instance.pause).toHaveBeenCalled();
    expect(script.remove).toHaveBeenCalled();
    expect(engine.isReady()).toBe(false);
    expect(engine.getHeap()).toBeNull();
  });
});
