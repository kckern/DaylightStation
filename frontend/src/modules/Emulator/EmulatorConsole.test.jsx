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
    pause: vi.fn(),
    resume: vi.fn(),
    boot: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
  };

  const mixer = {
    playMusic: vi.fn(),
    stopMusic: vi.fn(),
    playCue: vi.fn(),
    setBusVolume: vi.fn(),
    muteBus: vi.fn(),
  };

  const session = {
    start: vi.fn(() => Promise.resolve({ wramBase: 0xc000 })),
    stop: vi.fn(),
    destroy: vi.fn(),
    runActions: vi.fn(),
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
  // Controller panel is config-gated via the merged bezel presentation block
  // (origin's model); tests exercise it by enabling onscreen_controls there.
  presentation: { onscreen_controls: true },
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

  describe('bezel hotspots + overlays', () => {
    const presentation = {
      hotspots: [
        { id: 'speaker', action: 'volume', label: 'Volume', region: { x: 79, y: 64, width: 12, height: 22 } },
        { id: 'logo', action: 'exit', region: { x: 20, y: 88, width: 32, height: 5 } },
        { id: 'battery_led', do: { toast: 'Credit' }, region: { x: 19, y: 31, width: 2, height: 4 } },
      ],
      overlays: [
        { id: 'hr', source: 'fitness.heart_rate', format: 'bpm', region: { x: 15, y: 43, width: 12, height: 16 } },
        { id: 'badges', source: 'state.badges', format: 'badge_meter', region: { x: 71, y: 33, width: 12, height: 10 } },
      ],
    };
    const gameWithPresentation = { ...baseGame, presentation };

    it('renders hotspot buttons from presentation and steps volume on click', async () => {
      const { container, mixer } = renderConsole({ props: { game: gameWithPresentation } });
      await act(async () => {});
      const speaker = container.querySelector('[data-hotspot-id="speaker"]');
      expect(speaker).toBeTruthy();
      act(() => speaker.click());
      expect(mixer.setBusVolume).toHaveBeenLastCalledWith('game', 0.75);
    });

    it('routes an exit hotspot to onExit', async () => {
      const onExit = vi.fn();
      const { container } = renderConsole({ props: { game: gameWithPresentation, onExit } });
      await act(async () => {});
      act(() => container.querySelector('[data-hotspot-id="logo"]').click());
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('dispatches a do: hotspot through session.runActions', async () => {
      const { container, session } = renderConsole({ props: { game: gameWithPresentation } });
      await act(async () => {});
      act(() => container.querySelector('[data-hotspot-id="battery_led"]').click());
      expect(session.runActions).toHaveBeenCalledWith({ toast: 'Credit' }, { hotspot: 'battery_led' });
    });

    it('renders overlays and shows injected overlayData values', async () => {
      const { container } = renderConsole({
        props: { game: gameWithPresentation, overlayData: { 'fitness.heart_rate': 142 } },
      });
      await act(async () => {});
      const hr = container.querySelector('[data-overlay-id="hr"]');
      expect(hr).toBeTruthy();
      expect(hr.textContent).toContain('142');
      expect(hr.textContent).toContain('BPM');
    });

    it('renders game-state-driven overlays from session.getGameState()', async () => {
      const { container, session } = renderConsole({ props: { game: gameWithPresentation } });
      session.getGameState.mockReturnValue({ badges: 5 });
      await act(async () => {});
      act(() => vi.advanceTimersByTime(600)); // status/state poll
      const badges = container.querySelector('[data-overlay-id="badges"]');
      expect(badges.textContent).toContain('5');
    });

    it('renders no hotspot/overlay layers when presentation is absent', async () => {
      const { container } = renderConsole();
      await act(async () => {});
      expect(container.querySelector('.emu-hotspot-layer')).toBeNull();
      expect(container.querySelector('.emu-overlay-layer')).toBeNull();
    });
  });

  describe('controller panel', () => {
    const noPads = () => [];
    const onePad = () => [{ index: 0, id: 'Xbox', connected: true, buttons: [], axes: [] }];

    it('does NOT nag: stays collapsed on mount even when no gamepads are connected', async () => {
      const { container } = renderConsole({ props: { getGamepads: noPads } });
      await act(async () => {});
      expect(container.querySelector('.emulator-controller-panel')).toBeNull();
      expect(container.querySelector('.emulator-controller-toggle')).toBeTruthy();
    });

    it('starts collapsed when a gamepad is already connected', async () => {
      const { container } = renderConsole({ props: { getGamepads: onePad } });
      await act(async () => {});
      expect(container.querySelector('.emulator-controller-panel')).toBeNull();
      expect(container.querySelector('.emulator-controller-toggle')).toBeTruthy();
    });

    it('the toggle shows/hides the panel', async () => {
      const { container } = renderConsole({ props: { getGamepads: onePad } });
      await act(async () => {});
      const toggle = container.querySelector('.emulator-controller-toggle');
      expect(container.querySelector('.emulator-controller-panel')).toBeNull();
      act(() => toggle.click());
      expect(container.querySelector('.emulator-controller-panel')).toBeTruthy();
      act(() => toggle.click());
      expect(container.querySelector('.emulator-controller-panel')).toBeNull();
    });

    it('clicking Pair calls the injected fetch with the right URL/body and flips local pairing to scanning', async () => {
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 202 }));
      const { container } = renderConsole({
        props: { getGamepads: noPads, fetchImpl: () => fetchSpy },
      });
      await act(async () => {});

      // Panel no longer auto-opens; open it via the toggle first.
      act(() => container.querySelector('.emulator-controller-toggle').click());

      const button = container.querySelector('.ccs-pair-button');
      expect(button).toBeTruthy();
      await act(async () => {
        button.click();
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/v1/emulator/bt/pair');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({ durationMs: 30000 });

      // Local pairing flipped to scanning → button disabled + scanning label.
      const scanning = container.querySelector('.ccs-pair-button');
      expect(scanning.disabled).toBe(true);
      expect(scanning.textContent).toContain('Scanning for controllers');

      // After the window elapses, local pairing flips to done.
      await act(async () => {
        vi.advanceTimersByTime(30000);
      });
      expect(container.querySelector('.ccs-pair-button').textContent).toContain('Done');
    });

    it('sets error local pairing when the fetch rejects', async () => {
      const fetchSpy = vi.fn(() => Promise.reject(new Error('bridge offline')));
      const { container } = renderConsole({
        props: { getGamepads: noPads, fetchImpl: () => fetchSpy },
      });
      await act(async () => {});
      act(() => container.querySelector('.emulator-controller-toggle').click());
      await act(async () => {
        container.querySelector('.ccs-pair-button').click();
      });
      const button = container.querySelector('.ccs-pair-button');
      expect(button.textContent).toContain('Pairing failed — bridge offline');
      expect(button.disabled).toBe(false);
    });

    it('host pairing prop overrides console-managed local pairing', async () => {
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 202 }));
      const { container } = renderConsole({
        props: {
          getGamepads: noPads,
          fetchImpl: () => fetchSpy,
          pairing: { phase: 'scanning', durationMs: 30000 },
        },
      });
      await act(async () => {});
      act(() => container.querySelector('.emulator-controller-toggle').click());
      // Host says scanning even though no local pair was triggered.
      const button = container.querySelector('.ccs-pair-button');
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain('Scanning for controllers');
    });

    it('host onPairController override is called instead of the internal fetch', async () => {
      const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, status: 202 }));
      const onPairController = vi.fn();
      const { container } = renderConsole({
        props: { getGamepads: noPads, fetchImpl: () => fetchSpy, onPairController },
      });
      await act(async () => {});
      act(() => container.querySelector('.emulator-controller-toggle').click());
      await act(async () => {
        container.querySelector('.ccs-pair-button').click();
      });
      expect(onPairController).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
