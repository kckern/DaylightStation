import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { EmulatorConsole } from './EmulatorConsole.jsx';

/**
 * Build a set of injectable fake factories and capture the objects/args they
 * were called with so the tests can drive governance + the animation handler.
 */
function makeFactories() {
  const captured = {};

  const engine = {
    setVolume: vi.fn(),
    boot: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
  };

  const mixer = { playMusic: vi.fn(), stopMusic: vi.fn(), playCue: vi.fn() };

  const session = {
    start: vi.fn(() => Promise.resolve({ wramBase: 0xc000 })),
    stop: vi.fn(),
    destroy: vi.fn(),
    getGameState: vi.fn(() => ({})),
  };

  const createEngine = vi.fn(() => engine);
  const createMixer = vi.fn((opts) => {
    captured.mixerOpts = opts;
    return mixer;
  });
  const createSession = vi.fn((opts) => {
    captured.sessionOpts = opts;
    return session;
  });
  const createClip = vi.fn(() => ({
    play: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    onEnded: vi.fn(),
  }));

  return {
    captured,
    engine,
    mixer,
    session,
    factories: { createEngine, createMixer, createSession, createClip },
  };
}

/**
 * A controllable governance gate matching the documented shape.
 */
function makeGate(initialStatus = { state: 'playing' }) {
  let status = initialStatus;
  let cb = null;
  return {
    mode: 'governed',
    isPlayable: () => status.state === 'playing' || status.state === 'warning',
    getStatus: () => status,
    onChange: (fn) => {
      cb = fn;
      return () => {
        cb = null;
      };
    },
    // test driver
    _set(next) {
      status = next;
      if (cb) cb(status);
    },
    _hasSub: () => cb != null,
  };
}

const baseGame = {
  id: 'pokemon-red',
  system: 'gb',
  romUrl: '/rom.gb',
  states: {},
  bindings: [],
  chrome: 'gameboy',
  shader: 'lcd',
};

const baseEngineConfig = { pathtodata: '/data', core: 'gb' };

function renderConsole(overrides = {}) {
  const { factories, captured, engine, mixer, session } = makeFactories();
  const gate = overrides.gate || makeGate();
  const props = {
    game: baseGame,
    engineConfig: baseEngineConfig,
    governanceGate: gate,
    identity: { getActivePlayerId: () => 'p1' },
    factories,
    ...overrides.props,
  };
  const result = render(<EmulatorConsole {...props} />);
  return { ...result, factories, captured, engine, mixer, session, gate };
}

describe('EmulatorConsole', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the mount div and starts a session exactly once with that mount', async () => {
    const { container, factories, session } = renderConsole();
    // flush the async start() effect
    await act(async () => {});

    const mount = container.querySelector('.emulator-mount');
    expect(mount).toBeTruthy();

    expect(factories.createSession).toHaveBeenCalledTimes(1);
    expect(session.start).toHaveBeenCalledTimes(1);
    expect(session.start).toHaveBeenCalledWith({ mount });
  });

  it('wires the mixer with engine.setVolume as setGameVolume', async () => {
    const { captured, engine } = renderConsole();
    await act(async () => {});
    expect(captured.mixerOpts.setGameVolume).toBe(engine.setVolume);
    expect(typeof captured.mixerOpts.createClip).toBe('function');
  });

  it('shows no overlay while playing', async () => {
    const { container } = renderConsole();
    await act(async () => {});
    expect(container.querySelector('.emulator-console').getAttribute('data-state')).toBe('playing');
    expect(container.querySelector('.emulator-governance-overlay')).toBeNull();
  });

  it('reflects warning status with grace countdown', async () => {
    const gate = makeGate();
    const { container } = renderConsole({ gate });
    await act(async () => {});

    act(() => gate._set({ state: 'warning', graceMsLeft: 4200 }));

    const root = container.querySelector('.emulator-console');
    expect(root.getAttribute('data-state')).toBe('warning');
    const overlay = container.querySelector('.emulator-governance-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.className).toContain('overlay-warning');
    expect(overlay.textContent).toContain('Keep moving!');
    expect(overlay.textContent).toContain('5s'); // ceil(4200/1000)
  });

  it('reflects paused status', async () => {
    const gate = makeGate();
    const { container } = renderConsole({ gate });
    await act(async () => {});
    act(() => gate._set({ state: 'paused' }));
    const overlay = container.querySelector('.emulator-governance-overlay');
    expect(overlay.className).toContain('overlay-paused');
    expect(overlay.textContent).toContain('Paused');
  });

  it('reflects depleted status', async () => {
    const gate = makeGate();
    const { container } = renderConsole({ gate });
    await act(async () => {});
    act(() => gate._set({ state: 'depleted' }));
    const overlay = container.querySelector('.emulator-governance-overlay');
    expect(overlay.className).toContain('overlay-depleted');
    expect(overlay.textContent).toContain('earn more');
  });

  it('refreshes status on the polling interval (credit countdown)', async () => {
    let status = { state: 'playing' };
    const gate = {
      mode: 'governed',
      isPlayable: () => true,
      getStatus: () => status,
      onChange: () => () => {},
    };
    const { container } = renderConsole({ gate });
    await act(async () => {});
    // change status WITHOUT firing onChange — only the interval should catch it
    status = { state: 'paused' };
    act(() => vi.advanceTimersByTime(600));
    expect(container.querySelector('.emulator-console').getAttribute('data-state')).toBe('paused');
  });

  it('the merged animation handler adds a transient class that clears', async () => {
    const { container, captured } = renderConsole();
    await act(async () => {});

    const handlers = captured.sessionOpts.actionHandlers;
    expect(typeof handlers.animation).toBe('function');

    act(() => handlers.animation('red-pulse'));
    const shader = container.querySelector('.emulator-shader');
    expect(shader.className).toContain('emu-anim-red-pulse');

    act(() => vi.advanceTimersByTime(1100));
    expect(container.querySelector('.emulator-shader').className).not.toContain('emu-anim-red-pulse');
  });

  it('merged handlers preserve host-provided actionHandlers', async () => {
    const haScene = vi.fn();
    const { captured } = renderConsole({ props: { actionHandlers: { haScene } } });
    await act(async () => {});
    expect(captured.sessionOpts.actionHandlers.haScene).toBe(haScene);
    expect(typeof captured.sessionOpts.actionHandlers.animation).toBe('function');
  });

  it('cleans up on unmount: destroys session, clears interval and unsub', async () => {
    const gate = makeGate();
    const { unmount, session } = renderConsole({ gate });
    await act(async () => {});
    expect(gate._hasSub()).toBe(true);

    act(() => unmount());

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(gate._hasSub()).toBe(false);
    // no pending timers should fire into a torn-down tree
    expect(() => act(() => vi.advanceTimersByTime(2000))).not.toThrow();
  });
});
