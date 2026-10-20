import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock("../../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock("../../../../../../frontend/src/lib/logging/Logger.js", () => ({ default: () => ({ child: () => ({ info(){}, debug(){}, warn(){}, error(){} }) }) }));
const bus = vi.hoisted(() => {
  const state = { subscriptions: [] };
  state.subscribe = vi.fn((topic, handler) => {
    state.subscriptions.push({ topic, handler });
    return () => {};
  });
  return state;
});
vi.mock("../../../../../../frontend/src/services/WebSocketService.js", () => ({ wsService: bus }));

// Stub the heavy console so the test asserts wiring, not EmulatorJS boot.
vi.mock("../../../../../games/emulator/browser/EmulatorConsole.jsx", () => ({
  EmulatorConsole: (props) => (
    <>
      <div
        data-testid="console"
        data-game={props.game?.id}
        data-haskbd={!!props.engineConfig?.controls}
        data-core={props.engineConfig?.core}
        data-gate={props.governanceGate?.mode}
        data-persist={props.persistence?.persist ? '1' : '0'}
        data-user={props.persistence?.userId || ''}
        data-player={props.nowPlaying?.name || ''}
        data-coins={props.overlayData?.['session.coins'] ?? ''}
        data-system-label={props.systemLabel || ''}
        data-timer={props.sessionTimer?.text || ''}
        data-overlay-anchor={props.sessionOverlayConfig?.anchor || ''}
        data-menu-attention={props.menuAttention ? '1' : '0'}
        data-menu-open-at-launch={props.menuInitiallyOpen ? '1' : '0'}
      />
      {props.menuSection && (
        <div data-testid="menu">
          {typeof props.menuSection === 'function'
            ? props.menuSection({ closeMenu: () => {} })
            : props.menuSection}
        </div>
      )}
      <button data-testid="exit" onClick={() => props.onExit?.()}>exit</button>
      <button data-testid="play-signal" onClick={() => props.onArcadeGameSessionStateChange?.('playing')}>playing</button>
      <button data-testid="pause-signal" onClick={() => props.onArcadeGameSessionStateChange?.('paused')}>paused</button>
    </>
  ),
}));

// Identity + kiosk env are mocked so we can drive the launch flow deterministically.
const kiosk = { value: false };
// A developer's localhost is the ONLY exemption from the admin gate. Tests that
// are not about the gate run as dev; every gate test states the household host.
const devHost = { value: true };
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => kiosk.value, isLocalDevHost: () => devHost.value }));
const identity = {
  registerIdentify: vi.fn(),
  registerAdmin: vi.fn(),
  clearUnlock: vi.fn(),
  unlockState: 'idle',
  unlockedUser: null,
};
vi.mock("../../identity/useIdentity.js", () => ({ useIdentity: () => identity }));
vi.mock("../../player/overlays/UnlockPrompt.jsx", () => ({ default: ({ open }) => (open ? <div data-testid="unlock" /> : null) }));

// Stub saveClient so the resume lookup is controllable (no real fetch).
const saveClient = { loadResume: vi.fn(), persistResume: vi.fn(), clearResume: vi.fn() };
vi.mock("../../../../../games/emulator/browser/core/saveClient.js", () => ({ createSaveClient: () => saveClient }));

import EmulatorGameWidget from "./EmulatorGameWidget.jsx";
import { fullscreenClass } from "./emulatorGameWidgetLayout.js";

const fitnessContext = {
  getUserVitals: () => ({ zoneId: 'warm' }),
  zones: { cool: {}, warm: {}, hot: {} },
  userCollections: { all: [{ id: 'user_5', name: 'User_5' }] },
};

function libraryWith(saveMode, extra = {}) {
  return {
    systems: { gb: { core: 'gb' } },
    consoles: [{ system: 'gb', label: 'Game Boy', placeholder: false }, { system: null, label: null, placeholder: true }],
    games: [{ id: 'example-quest', system: 'gb', title: 'Example Quest', coverUrl: '/cover', saveMode, ...extra }],
    input: { keyboard: { up: 'ArrowUp', start: 'Enter', a: 'x', b: 'z' } },
  };
}

beforeEach(() => {
  api.mockReset();
  kiosk.value = false;
  devHost.value = true;
  identity.registerIdentify.mockReset();
  identity.registerAdmin.mockReset();
  identity.clearUnlock.mockReset();
  saveClient.loadResume.mockReset();
  saveClient.persistResume.mockReset();
  saveClient.clearResume.mockReset();
  bus.subscriptions = [];
  bus.subscribe.mockClear();
  delete window.__emulatorCapturingGamepad;
});
afterEach(() => { delete window.__emulatorCapturingGamepad; });

describe('EmulatorGameWidget arcade shell', () => {
  it('meters the explicit fleet device with a stable canonical load lifecycle', async () => {
    api.mockImplementation((path) => (path === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('none'))
      : Promise.resolve({})));
    render(
      <EmulatorGameWidget
        fitnessContext={fitnessContext}
        deviceId="garage-tv"
        onClose={() => {}}
        config={{}}
        onMount={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    await waitFor(() => {
      const [, body] = api.mock.calls.find(([path]) => path === 'api/v1/arcade-game-sessions/observations') || [];
      expect(body).toMatchObject({
        deviceId: 'garage-tv',
        observation: {
          state: 'paused', loaded: true,
          content: {
            contentId: 'arcade:gb/example-quest', console: 'gb', consoleLabel: 'Game Boy',
          },
        },
      });
      expect(body.observation.loadId).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('play-signal'));
    await waitFor(() => expect(api.mock.calls.some(([path, body]) => (
      path === 'api/v1/arcade-game-sessions/observations' && body?.observation?.state === 'playing'
    ))).toBe(true));
  });

  it('subscribes to the device play feed and feeds the server clock to the console', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} deviceId="garage-tv" onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(bus.subscribe).toHaveBeenCalledWith(
      'arcade-session:garage-tv', expect.any(Function),
    ));
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');

    const subscription = bus.subscriptions.find((entry) => entry.topic === 'arcade-session:garage-tv');
    subscription.handler({
      event: 'arcade.session.progress', state: 'playing', playedMs: 95_000, systemLabel: 'Game Boy',
      overlay: { anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5, fields: ['player', 'timer'] },
    });

    await waitFor(() => expect(screen.getByTestId('console')).toHaveAttribute('data-timer', '01:35'));
    expect(screen.getByTestId('console')).toHaveAttribute('data-system-label', 'Game Boy');
    expect(screen.getByTestId('console')).toHaveAttribute('data-overlay-anchor', 'top-left');
  });

  it('shows the arcade grid first (no console until a game is picked)', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    expect(screen.queryByTestId('console')).toBeNull();
    expect(window.__emulatorCapturingGamepad).toBeFalsy(); // arcade keeps the pad
    expect(api).toHaveBeenCalledWith('api/v1/emulator/library');
  });

  it('launches a no-save game on tap: open gate, controls, no persistence, pad captured', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-game')).toBe('example-quest');
    expect(el.getAttribute('data-haskbd')).toBe('true');
    expect(el.getAttribute('data-gate')).toBe('open'); // governance disabled
    expect(el.getAttribute('data-persist')).toBe('0');
    expect(window.__emulatorCapturingGamepad).toBe(true);
  });

  it('on a developer\'s localhost: a save-enabled game skips fingerprint and cold-starts', async () => {
    api.mockResolvedValue(libraryWith('battery'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0');
    expect(identity.registerIdentify).not.toHaveBeenCalled();
  });

  // THE HOLE THIS CLOSES: the gate applied only on the Firefox kiosk, so a
  // tablet or laptop on the household host opened any game with no approval.
  it('a browser that is not the kiosk still needs the admin fingerprint', async () => {
    kiosk.value = false;
    devHost.value = false;
    api.mockResolvedValue(libraryWith('none'));
    identity.registerAdmin.mockResolvedValue({ matched: false });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalledWith('emulator'));
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    expect(screen.queryByTestId('console')).toBeNull();
  });

  it('only settings.adminGate:false opens the arcade on the household host', async () => {
    devHost.value = false;
    api.mockResolvedValue({ ...libraryWith('none'), settings: { adminGate: false } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    expect(identity.registerAdmin).not.toHaveBeenCalled();
  });

  it('a per-game core override (GBA in the gb category) reaches the engine config', async () => {
    api.mockResolvedValue({
      systems: { gb: { core: 'gb' } },
      consoles: [{ system: 'gb', label: 'Game Boy', placeholder: false }],
      games: [
        { id: 'example-quest', system: 'gb', title: 'Example Quest', coverUrl: '/c', saveMode: 'none' },
        { id: 'mario-kart', system: 'gb', title: 'Mario Kart', coverUrl: '/c2', saveMode: 'none', core: 'gba' },
      ],
      input: { keyboard: {} },
    });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Mario Kart')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Mario Kart'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-game')).toBe('mario-kart');
    expect(el.getAttribute('data-core')).toBe('gba'); // per-game override, not the system 'gb'
  });

  it('kiosk: the portaled fullscreen wrapper carries kiosk-ui (cursor-hide reaches it)', async () => {
    kiosk.value = true;
    devHost.value = false;
    // On kiosk every launch passes the admin gate first (origin's save-flow); grant it so we reach 'playing'.
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    api.mockResolvedValue(libraryWith('none')); // no-save game then boots straight to playing
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    const wrapper = document.querySelector('.fitness-emulator-fullscreen');
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain('kiosk-ui');
  });

  it('off-kiosk: the portaled fullscreen wrapper omits kiosk-ui', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    const wrapper = document.querySelector('.fitness-emulator-fullscreen');
    expect(wrapper.className).not.toContain('kiosk-ui');
  });

  it('releases the gamepad on unmount', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const { unmount } = render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    unmount();
    expect(window.__emulatorCapturingGamepad).toBeFalsy();
  });
});

describe('fullscreenClass', () => {
  it('adds kiosk-ui when kiosk', () => { expect(fullscreenClass(true)).toBe('fitness-emulator-fullscreen kiosk-ui'); });
  it('omits kiosk-ui when not kiosk', () => { expect(fullscreenClass(false)).toBe('fitness-emulator-fullscreen'); });
});

describe('EmulatorGameWidget save flow', () => {
  it('save-enabled kiosk launch: admin gate first, then boots fresh with savers in the game menu', async () => {
    kiosk.value = true;
    devHost.value = false;
    api.mockImplementation((p) => {
      if (p === 'api/v1/emulator/library') return Promise.resolve(libraryWith('battery'));
      if (p.startsWith('api/v1/emulator/saves/')) return Promise.resolve({ users: ['user_5'] });
      return Promise.resolve({});
    });
    identity.registerAdmin.mockResolvedValue({ matched: true, userId: 'dad', authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0'); // fresh + anonymous
    expect(el.getAttribute('data-menu-attention')).toBe('1'); // "not saving" dot
    expect(await screen.findByLabelText('Continue as User_5')).toBeTruthy();
    expect(screen.getByText('Not saving')).toBeTruthy();
  });

  it('second launch in the same session skips the admin gate', async () => {
    kiosk.value = true;
    devHost.value = false;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('none'))
      : Promise.resolve({ users: [] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    fireEvent.click(screen.getByTestId('exit'));
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    expect(identity.registerAdmin).toHaveBeenCalledTimes(1);
  });

  it('loading a saver verifies identity then remounts persisting under them', async () => {
    kiosk.value = true;
    devHost.value = false;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('battery'))
      : Promise.resolve({ users: ['user_5'] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_5' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    fireEvent.click(await screen.findByLabelText('Continue as User_5'));
    await waitFor(() => {
      const el = screen.getByTestId('console');
      expect(el.getAttribute('data-persist')).toBe('1');
      expect(el.getAttribute('data-user')).toBe('user_5');
    });
  });

  it('claim as an existing saver warns, then Overwrite turns on persistence', async () => {
    kiosk.value = true;
    devHost.value = false;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('battery'))
      : Promise.resolve({ users: ['user_5'] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_5' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByLabelText('Continue as User_5');
    // Claim the running fresh game; the scanner (user_5) already has a save → conflict warning.
    fireEvent.click(screen.getByText('Save as me'));
    const overwrite = await screen.findByText('Overwrite');
    // Still anonymous until the user confirms the overwrite.
    expect(screen.getByTestId('console').getAttribute('data-persist')).toBe('0');
    fireEvent.click(overwrite);
    await waitFor(() => {
      const el = screen.getByTestId('console');
      expect(el.getAttribute('data-persist')).toBe('1');
      expect(el.getAttribute('data-user')).toBe('user_5');
    });
  });
});

describe('EmulatorGameWidget save choice at launch', () => {
  function sharedApi(users = ['user_5']) {
    api.mockImplementation((p) => {
      if (p === 'api/v1/emulator/library') return Promise.resolve(libraryWith('battery'));
      if (p.startsWith('api/v1/emulator/saves/')) return Promise.resolve({ users });
      return Promise.resolve({});
    });
  }
  async function launch() {
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    return screen.findByTestId('console');
  }

  it('kiosk + shared save game + nobody saving: menu opens at launch with Just play', async () => {
    kiosk.value = true;
    sharedApi([]); // a brand-new kid: no savers yet
    const el = await launch();
    expect(el.getAttribute('data-menu-open-at-launch')).toBe('1');
    expect(screen.getByText('Save as me')).toBeTruthy();
    expect(screen.getByText('Just play')).toBeTruthy();
  });

  it('a game without saves starts straight into play', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => Promise.resolve(p === 'api/v1/emulator/library' ? libraryWith('none') : {}));
    const el = await launch();
    expect(el.getAttribute('data-menu-open-at-launch')).toBe('0');
  });

  it('off the kiosk: closed at launch, and the panel says where saving works', async () => {
    kiosk.value = false;
    sharedApi();
    const el = await launch();
    expect(el.getAttribute('data-menu-open-at-launch')).toBe('0');
    expect(screen.getByText('Saving works at the garage')).toBeTruthy();
    expect(screen.queryByText('Save as me')).toBeNull();
  });

  it('loading a saver boots closed (no second ask)', async () => {
    kiosk.value = true;
    sharedApi();
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_5' });
    await launch();
    fireEvent.click(await screen.findByLabelText('Continue as User_5'));
    await waitFor(() => expect(screen.getByTestId('console').getAttribute('data-user')).toBe('user_5'));
    expect(screen.getByTestId('console').getAttribute('data-menu-open-at-launch')).toBe('0');
  });
});

describe('EmulatorGameWidget owned save game (save_owner)', () => {
  function ownedApi() {
    api.mockImplementation((p) => {
      if (p === 'api/v1/emulator/library') return Promise.resolve(libraryWith('battery', { saveOwner: 'user_5' }));
      if (p.startsWith('api/v1/emulator/saves/')) return Promise.resolve({ users: ['user_5'] });
      return Promise.resolve({});
    });
  }

  it("the owner's scan boots straight into their save, locked in the menu", async () => {
    kiosk.value = true;
    ownedApi();
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'User_5' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await waitFor(() => expect(identity.registerIdentify).toHaveBeenCalled());
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('1');
    expect(el.getAttribute('data-user')).toBe('user_5');
    expect(el.getAttribute('data-menu-attention')).toBe('0');
    expect(el.getAttribute('data-menu-open-at-launch')).toBe('0');
    expect(screen.getByText("User_5's game · saving")).toBeTruthy();
    expect(screen.queryByText('Save as me')).toBeNull();
    expect(screen.queryByLabelText('Continue as User_5')).toBeNull();
  });

  it('anyone else is turned back to the arcade with nothing mounted', async () => {
    kiosk.value = true;
    ownedApi();
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_4' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    expect(await screen.findByText("Example Quest is User_5's game.")).toBeTruthy();
    expect(screen.queryByTestId('console')).toBeNull();
  });

  it('off-kiosk it never asks for a scan (no prompt there) and says where it plays', async () => {
    kiosk.value = false;
    ownedApi();
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    expect(await screen.findByText("Example Quest is User_5's game — play it at the garage.")).toBeTruthy();
    expect(identity.registerIdentify).not.toHaveBeenCalled();
    expect(screen.queryByTestId('console')).toBeNull();
  });

  it('a cancelled scan returns to the arcade without booting', async () => {
    kiosk.value = true;
    ownedApi();
    identity.registerIdentify.mockResolvedValue(null);
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await waitFor(() => expect(identity.registerIdentify).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    expect(screen.queryByTestId('console')).toBeNull();
  });
});

describe('EmulatorGameWidget coin economy', () => {
  // fitnessContext exposing a resolvable active player so spenderId is set even
  // without an identity unlock (off-kiosk free launch path).
  const economyFitnessContext = {
    ...fitnessContext,
    getActivePlayerId: () => 'user_5',
  };

  function makeEconomyApi() {
    return {
      openSession: vi.fn().mockResolvedValue({ sessionId: 'sess-1', balance: 42, drainPerSecond: 0.1 }),
      settle: vi.fn().mockResolvedValue({}),
      close: vi.fn().mockResolvedValue({ balance: 40 }),
    };
  }

  it('economy on + resolvable player: builds a coin-metered gate and starts a spend session', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const economyApi = makeEconomyApi();
    render(
      <EmulatorGameWidget
        fitnessContext={economyFitnessContext}
        onClose={() => {}}
        config={{ economy: { enabled: true, api: economyApi } }}
        onMount={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-gate')).toBe('coin-metered');
    // start() opens a spend session against the injected economy api.
    await waitFor(() => expect(economyApi.openSession).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_5', action: 'arcade-play' }),
    ));
  });

  it('economy on: unmount stops the gate and closes the spend session', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const economyApi = makeEconomyApi();
    const { unmount } = render(
      <EmulatorGameWidget
        fitnessContext={economyFitnessContext}
        onClose={() => {}}
        config={{ economy: { enabled: true, api: economyApi } }}
        onMount={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    // Wait until the session is open (coins reflect the opened balance) so close has a sessionId.
    await waitFor(() => expect(screen.getByTestId('console').getAttribute('data-coins')).toBe('42'));
    unmount();
    await waitFor(() => expect(economyApi.close).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_5', sessionId: 'sess-1' }),
    ));
  });

  it('economy on: the live coin balance threads into the console overlay session.coins', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const economyApi = makeEconomyApi();
    render(
      <EmulatorGameWidget
        fitnessContext={economyFitnessContext}
        onClose={() => {}}
        config={{ economy: { enabled: true, api: economyApi } }}
        onMount={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    await screen.findByTestId('console');
    await waitFor(() => expect(screen.getByTestId('console').getAttribute('data-coins')).toBe('42'));
  });

  it('economy off (default): open gate, no economy api calls, no coins overlay', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const economyApi = makeEconomyApi();
    render(
      <EmulatorGameWidget
        fitnessContext={economyFitnessContext}
        onClose={() => {}}
        config={{ economy: { enabled: false, api: economyApi } }}
        onMount={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Example Quest')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Example Quest'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-gate')).toBe('open');
    expect(el.getAttribute('data-coins')).toBe(''); // '—' fallback stays in the console
    expect(economyApi.openSession).not.toHaveBeenCalled();
  });
});
