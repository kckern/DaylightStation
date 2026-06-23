import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ parsed: { games: {} } })),
}));

import { PianoMidiProvider } from '../../PianoMidiContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import { Games } from './Games.jsx';

const testConfig = {
  voices: [], videos: { plexCollection: null }, games: {},
  midi: { preferredInputName: null }, inactivityMinutes: 10, label: 'Test',
};

// Games renders its own <Routes>, so mount it under a "games/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it (path="games/*"). The game
// id lives in the URL; assertions check the right view per path.
function renderGames(initialEntry = '/games') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ActivePianoProvider pianoId="test" config={testConfig}>
        <PianoMidiProvider>
          <Routes>
            <Route path="games/*" element={<Games />} />
          </Routes>
        </PianoMidiProvider>
      </ActivePianoProvider>
    </MemoryRouter>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Games mode', () => {
  it('renders a picker tile per registered game with friendly labels (index route)', () => {
    renderGames();
    for (const label of ['Space Invaders', 'Tetris', 'Flashcards', 'Note Hero', 'Side Scroller']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('navigates to the game host on tile click (relative nav)', () => {
    renderGames();
    fireEvent.click(screen.getByText('Tetris'));
    // Now on /games/tetris — GameHost. Since LazyComponent uses dynamic import
    // (won't load in test env), it shows the "Game not found" fallback OR the
    // Suspense Loading placeholder. Either way the picker tiles are gone.
    expect(screen.queryByText('Space Invaders')).toBeNull();
  });

  it('shows "Game not found" with a Back button for an unknown game id (deep-link)', () => {
    renderGames('/games/nonexistent-game');
    // GameHost: entry is null → placeholder with back button.
    expect(screen.getByText(/Game not found/i)).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('back button from game host returns to picker', () => {
    renderGames('/games/nonexistent-game');
    fireEvent.click(screen.getByText('Back'));
    // Navigated up to /games — picker is visible again.
    expect(screen.getByText('Space Invaders')).toBeTruthy();
  });
});
