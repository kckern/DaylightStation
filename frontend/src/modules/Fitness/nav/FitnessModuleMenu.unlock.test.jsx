import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

// Fitness config carries the locks map; both context aliases resolve to it.
let mockCtx;
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitness: () => mockCtx,
  useFitnessContext: () => mockCtx
}));

// The menu loads its item list from the fitness API; return a single Dance Party item.
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({
    fitness: {
      plex: {
        app_menus: [
          { id: 'games', name: 'Games', items: [{ id: 'dance_party', name: 'Dance Party' }] }
        ]
      }
    }
  }))
}));

// Module registry: only resolve the dance_party manifest so the card renders.
vi.mock('../index', () => ({
  listModules: () => [],
  getModuleManifest: (id) =>
    id === 'dance_party'
      ? { id: 'dance_party', name: 'Dance Party', icon: '🪩', description: 'Disco' }
      : null
}));

vi.mock('../player/useModuleStorage', () => ({
  default: () => ({ clearAll: vi.fn() })
}));

// Control the unlock hook: tests drive state + requestUnlock resolution.
const requestUnlock = vi.fn();
const reset = vi.fn();
let unlockState = 'idle';
vi.mock('@/modules/Fitness/hooks/useUnlock.js', () => ({
  useUnlock: () => ({ requestUnlock, reset, state: unlockState, activeLock: null })
}));

import FitnessModuleMenu from './FitnessModuleMenu.jsx';

const LOCKED_CTX = { fitnessConfiguration: { locks: { dance_party: ['test-user'] } } };
const UNLOCKED_CTX = { fitnessConfiguration: {} };

async function renderMenu() {
  let utils;
  await act(async () => {
    utils = render(
      <FitnessModuleMenu activeModuleMenuId="games" onModuleSelect={onModuleSelect} onBack={() => {}} />
    );
  });
  // Wait for the async menu load to settle and the card to appear.
  await screen.findByText('Dance Party');
  return utils;
}

let onModuleSelect;

beforeEach(() => {
  vi.clearAllMocks();
  unlockState = 'idle';
  onModuleSelect = vi.fn();
  requestUnlock.mockResolvedValue({ matched: false, reason: 'denied' });
});

describe('FitnessModuleMenu — Dance Party unlock gate', () => {
  it('opens the unlock prompt and does NOT launch when the lock is configured', async () => {
    mockCtx = LOCKED_CTX;
    await renderMenu();

    const card = screen.getByText('Dance Party').closest('button');
    await act(async () => { fireEvent.pointerDown(card); });

    // Prompt is shown, launch is gated.
    expect(requestUnlock).toHaveBeenCalledWith('dance_party');
    expect(screen.getByRole('dialog', { name: /fingerprint unlock/i })).toBeTruthy();
    expect(onModuleSelect).not.toHaveBeenCalled();
  });

  it('performs the original launch when the fingerprint matches', async () => {
    mockCtx = LOCKED_CTX;
    requestUnlock.mockResolvedValue({ matched: true, userId: 'test-user' });
    await renderMenu();

    const card = screen.getByText('Dance Party').closest('button');
    await act(async () => { fireEvent.pointerDown(card); });

    await waitFor(() =>
      expect(onModuleSelect).toHaveBeenCalledWith(
        'dance_party',
        expect.objectContaining({ id: 'dance_party' })
      )
    );
  });

  it('launches directly with no prompt when no lock is configured', async () => {
    mockCtx = UNLOCKED_CTX;
    await renderMenu();

    const card = screen.getByText('Dance Party').closest('button');
    await act(async () => { fireEvent.pointerDown(card); });

    expect(onModuleSelect).toHaveBeenCalledWith(
      'dance_party',
      expect.objectContaining({ id: 'dance_party' })
    );
    expect(requestUnlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /fingerprint unlock/i })).toBeNull();
  });
});
