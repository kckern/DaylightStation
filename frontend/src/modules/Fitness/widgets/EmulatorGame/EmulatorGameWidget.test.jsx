import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info(){}, debug(){}, warn(){}, error(){} }) }) }));

// Stub the heavy console so the test asserts wiring, not EmulatorJS boot.
vi.mock('../../../Emulator/EmulatorConsole.jsx', () => ({
  EmulatorConsole: (props) => (
    <div
      data-testid="console"
      data-game={props.game?.id}
      data-haskbd={!!props.engineConfig?.controls}
      data-gate={props.governanceGate?.mode}
      data-persist={props.persistence?.persist ? '1' : '0'}
      data-user={props.persistence?.userId || ''}
      data-player={props.nowPlaying?.name || ''}
    />
  ),
}));

// Identity + kiosk env are mocked so we can drive the launch flow deterministically.
const kiosk = { value: false };
vi.mock('@/lib/kioskEnv.js', () => ({ isKioskEnv: () => kiosk.value }));
const identity = { registerIdentify: vi.fn(), clearUnlock: vi.fn(), unlockState: 'idle', unlockedUser: null };
vi.mock('../../identity/IdentityProvider', () => ({ useIdentity: () => identity }));
vi.mock('../../player/overlays/UnlockPrompt.jsx', () => ({ default: ({ open }) => (open ? <div data-testid="unlock" /> : null) }));

// Stub saveClient so the resume lookup is controllable (no real fetch).
const saveClient = { loadResume: vi.fn(), persist: vi.fn(), clear: vi.fn() };
vi.mock('../../../Emulator/core/saveClient.js', () => ({ createSaveClient: () => saveClient }));

import EmulatorGameWidget from './EmulatorGameWidget.jsx';

const fitnessContext = {
  getUserVitals: () => ({ zoneId: 'warm' }),
  zones: { cool: {}, warm: {}, hot: {} },
  userCollections: { all: [{ id: 'soren', name: 'Soren' }] },
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
  identity.clearUnlock.mockReset();
  saveClient.loadResume.mockReset();
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

  it('kiosk + save game: fingerprint match → resume under that user (persist)', async () => {
    kiosk.value = true;
    api.mockResolvedValue(libraryWith('battery'));
    identity.registerIdentify.mockResolvedValue({ matched: true, userId: 'soren' });
    saveClient.loadResume.mockResolvedValue(new ArrayBuffer(8)); // has a save
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    const el = await screen.findByTestId('console');
    expect(identity.registerIdentify).toHaveBeenCalled();
    expect(el.getAttribute('data-persist')).toBe('1');
    expect(el.getAttribute('data-user')).toBe('soren');
    expect(el.getAttribute('data-player')).toBe('Soren');
  });

  it('kiosk + save game: cancelled fingerprint → cold start (no persist)', async () => {
    kiosk.value = true;
    api.mockResolvedValue(libraryWith('battery'));
    identity.registerIdentify.mockResolvedValue({ matched: false });
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('Pokémon Red')).toBeTruthy());
    fireEvent.pointerDown(screen.getByLabelText('Pokémon Red'));
    const el = await screen.findByTestId('console');
    expect(el.getAttribute('data-persist')).toBe('0');
    expect(el.getAttribute('data-user')).toBe('');
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
