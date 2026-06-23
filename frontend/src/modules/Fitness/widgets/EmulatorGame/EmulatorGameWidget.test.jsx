import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const api = vi.fn();
vi.mock('../../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => api(...a), DaylightMediaPath: (p) => p }));
vi.mock('../../../../lib/logging/Logger.js', () => ({ default: () => ({ child: () => ({ info(){}, debug(){}, warn(){}, error(){} }) }) }));
// Stub the heavy console so the test asserts wiring, not EmulatorJS boot.
vi.mock('../../../Emulator/EmulatorConsole.jsx', () => ({
  EmulatorConsole: (props) => <div data-testid="console" data-game={props.game?.id}
    data-haskbd={!!props.engineConfig?.controls} data-gate={props.governanceGate?.mode} />,
}));

import EmulatorGameWidget from './EmulatorGameWidget.jsx';

const fitnessContext = { getUserVitals: () => ({ zoneId: 'warm' }), zones: { cool:{}, warm:{}, hot:{} } };

beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({
    systems: { gb: { core: 'gb' } },
    games: [{ id: 'pokemon-red', system: 'gb', title: 'Pokémon Red', romUrl: '/rom', chrome: 'gb-bezel', shader: 'dotmatrix',
              governance: { mode: 'credit', required_zone: 'warm', earn_rate: 1.5, max_credit_seconds: 600 } }],
    input: { keyboard: { up: 'ArrowUp', start: 'Enter', a: 'x', b: 'z' } },
  });
  delete window.__emulatorCapturingGamepad;
});
afterEach(() => { delete window.__emulatorCapturingGamepad; });

describe('EmulatorGameWidget', () => {
  it('loads the library, builds controls + an open (ungoverned) gate, renders the console', async () => {
    render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('console')).toBeTruthy());
    const el = screen.getByTestId('console');
    expect(el.getAttribute('data-game')).toBe('pokemon-red');
    expect(el.getAttribute('data-haskbd')).toBe('true');
    // Governance is disabled: gate is always open regardless of the game's config.
    expect(el.getAttribute('data-gate')).toBe('open');
    expect(api).toHaveBeenCalledWith('api/v1/emulator/library');
  });

  it('captures the gamepad while mounted and releases on unmount', async () => {
    const { unmount } = render(<EmulatorGameWidget fitnessContext={fitnessContext} onClose={() => {}} config={{}} onMount={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('console')).toBeTruthy());
    expect(window.__emulatorCapturingGamepad).toBe(true);
    unmount();
    expect(window.__emulatorCapturingGamepad).toBeFalsy();
  });
});
