import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info(){}, debug(){}, warn(){}, error(){} }) }) }));

// Stub the heavy console so the test asserts wiring, not EmulatorJS boot.
vi.mock('../../../Emulator/EmulatorConsole.jsx', () => ({
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
      />
      <button data-testid="exit" onClick={() => props.onExit?.()}>exit</button>
    </>
  ),
}));

// Identity + kiosk env are mocked so we can drive the launch flow deterministically.
const kiosk = { value: false };
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => kiosk.value }));
const identity = {
  registerIdentify: vi.fn(),
  registerAdmin: vi.fn(),
  clearUnlock: vi.fn(),
  unlockState: 'idle',
  unlockedUser: null,
};
vi.mock('../../identity/IdentityProvider', () => ({ useIdentity: () => identity }));
vi.mock('../../player/overlays/UnlockPrompt.jsx', () => ({ default: ({ open }) => (open ? <div data-testid="unlock" /> : null) }));

// Stub saveClient so the resume lookup is controllable (no real fetch).
const saveClient = { loadResume: vi.fn(), persistResume: vi.fn(), clearResume: vi.fn() };
vi.mock('../../../Emulator/core/saveClient.js', () => ({ createSaveClient: () => saveClient }));

vi.mock('../../../Emulator/ui/PlayerSelect.jsx', () => ({
  PlayerSelect: ({ visible, savers, onLoad, onClaim }) => (visible ? (
    <div data-testid="player-select">
      {savers.map((s) => (
        <button key={s.userId} data-testid={`saver-${s.userId}`} onClick={() => onLoad(s.userId)}>{s.name}</button>
      ))}
      <button data-testid="claim" onClick={onClaim}>Save my game</button>
    </div>
  ) : null),
}));

import EmulatorGameWidget, { fullscreenClass } from './EmulatorGameWidget.jsx';

const fitnessContext = {
  getUserVitals: () => ({ zoneId: 'warm' }),
  zones: { cool: {}, warm: {}, hot: {} },
  userCollections: { all: [{ id: 'user_5', name: 'User_5' }] },
};

function libraryWith(saveMode) {
  return {
    systems: { gb: { core: 'gb' } },
    consoles: [{ system: 'gb', label: 'Game Boy', placeholder: false }, { system: null, label: null, placeholder: true }],
    games: [{ id: 'pokemon-red', system: 'gb', title: 'Pokémon Red', coverUrl: '/cover', saveMode }],
    input: { keyboard: { up: 'ArrowUp', start: 'Enter', a: 'x', b: 'z' } },
  };
}

beforeEach(() => {
  api.mockReset();
  kiosk.value = false;
  identity.registerIdentify.mockReset();
  identity.registerAdmin.mockReset();
  identity.clearUnlock.mockReset();
  saveClient.loadResume.mockReset();
  saveClient.persistResume.mockReset();
  saveClient.clearResume.mockReset();
  delete window.__emulatorCapturingGamepad;
});
afterEach(() => { delete window.__emulatorCapturingGamepad; });

describe('EmulatorGameWidget arcade shell', () => {
  it('shows the arcade grid first (no console until a game is picked)', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    expect(screen.queryByTestId('console')).toBeNull();
    expect(window.__emulatorCapturingGamepad).toBeFalsy(); // arcade keeps the pad
    expect(api).toHaveBeenCalledWith('api/v1/emulator/library');
  });

  it('launches a no-save game on tap: open gate, controls, no persistence, pad captured', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-game')).toBe('pokemon-red');
    expect(el.getAttribute('data-haskbd')).toBe('true');
    expect(el.getAttribute('data-gate')).toBe('open'); // governance disabled
    expect(el.getAttribute('data-persist')).toBe('0');
    expect(window.__emulatorCapturingGamepad).toBe(true);
  });

  it('off-kiosk: a save-enabled game skips fingerprint and cold-starts', async () => {
    api.mockResolvedValue(libraryWith('battery'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0');
    expect(identity.registerIdentify).not.toHaveBeenCalled();
  });

  it('a per-game core override (GBA in the gb category) reaches the engine config', async () => {
    api.mockResolvedValue({
      systems: { gb: { core: 'gb' } },
      consoles: [{ system: 'gb', label: 'Game Boy', placeholder: false }],
      games: [
        { id: 'pokemon-red', system: 'gb', title: 'Pokémon Red', coverUrl: '/c', saveMode: 'none' },
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
    // On kiosk every launch passes the admin gate first (origin's save-flow); grant it so we reach 'playing'.
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    api.mockResolvedValue(libraryWith('none')); // no-save game then boots straight to playing
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('console');
    const wrapper = document.querySelector('.fitness-emulator-fullscreen');
    expect(wrapper).toBeTruthy();
    expect(wrapper.className).toContain('kiosk-ui');
  });

  it('off-kiosk: the portaled fullscreen wrapper omits kiosk-ui', async () => {
    api.mockResolvedValue(libraryWith('none'));
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('console');
    const wrapper = document.querySelector('.fitness-emulator-fullscreen');
    expect(wrapper.className).not.toContain('kiosk-ui');
  });

  it('releases the gamepad on unmount', async () => {
    api.mockResolvedValue(libraryWith('none'));
    const { unmount } = render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
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
  it('save-enabled kiosk launch: admin gate first, then boots fresh + opens PlayerSelect', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => {
      if (p === 'api/v1/emulator/library') return Promise.resolve(libraryWith('battery'));
      if (p.startsWith('api/v1/emulator/saves/')) return Promise.resolve({ users: ['user_5'] });
      return Promise.resolve({});
    });
    identity.registerAdmin.mockResolvedValue({ matched: true, userId: 'dad', authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await waitFor(() => expect(identity.registerAdmin).toHaveBeenCalled());
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0'); // fresh + anonymous
    await screen.findByTestId('player-select');
    expect(screen.getByTestId('saver-user_5')).toBeTruthy();
  });

  it('second launch in the same session skips the admin gate', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('none'))
      : Promise.resolve({ users: [] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('console');
    fireEvent.click(screen.getByTestId('exit'));
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('console');
    expect(identity.registerAdmin).toHaveBeenCalledTimes(1);
  });

  it('loading a saver verifies identity then remounts persisting under them', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('battery'))
      : Promise.resolve({ users: ['user_5'] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_5' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('player-select');
    fireEvent.click(screen.getByTestId('saver-user_5'));
    await waitFor(() => {
      const el = screen.getByTestId('console');
      expect(el.getAttribute('data-persist')).toBe('1');
      expect(el.getAttribute('data-user')).toBe('user_5');
    });
  });

  it('claim as an existing saver warns, then Overwrite turns on persistence', async () => {
    kiosk.value = true;
    api.mockImplementation((p) => (p === 'api/v1/emulator/library'
      ? Promise.resolve(libraryWith('battery'))
      : Promise.resolve({ users: ['user_5'] })));
    identity.registerAdmin.mockResolvedValue({ matched: true, authz: { admin: true } });
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'user_5' });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    await screen.findByTestId('player-select');
    // Claim the running fresh game; the scanner (user_5) already has a save → conflict warning.
    fireEvent.click(screen.getByTestId('claim'));
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
