import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, resolvePath } from 'react-router-dom';

const schoolAccess = vi.hoisted(() => ({ unlocked: true }));
const gameBudget = vi.hoisted(() => ({ state: 'off', secondsLeft: 0, warn: false }));

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ parsed: { games: {} } })),
}));
vi.mock('../../useSchoolGameAccess.js', () => ({
  default: () => ({
    status: 'ready', state: schoolAccess.unlocked ? 'complete' : 'incomplete',
    unlocked: schoolAccess.unlocked, refresh: vi.fn(),
  }),
}));
vi.mock('../../useGameBudgetMeter.js', () => ({
  default: () => gameBudget,
}));

import { PianoMidiProvider } from '../../PianoMidiContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import PianoUserContext from '../../PianoUserContext.jsx';
import { Games, gameSubRouteTarget } from './Games.jsx';

const testConfig = {
  voices: [], videos: { plexCollection: null }, games: {},
  midi: { preferredInputName: null }, inactivityMinutes: 10, label: 'Test',
};

// Games renders its own <Routes>, so mount it under a "games/*" route inside a
// MemoryRouter — mirroring how PianoShell mounts it (path="games/*"). The game
// id lives in the URL; assertions check the right view per path.
function renderGames(initialEntry = '/games', currentUser = 'guest') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ActivePianoProvider pianoId="test" config={testConfig}>
        <PianoUserContext.Provider value={{ currentUser, currentProfile: { id: currentUser, name: currentUser } }}>
          <PianoMidiProvider>
            <Routes>
              <Route path="games/*" element={<Games />} />
            </Routes>
          </PianoMidiProvider>
        </PianoUserContext.Provider>
      </ActivePianoProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  schoolAccess.unlocked = true;
  gameBudget.state = 'off';
  gameBudget.secondsLeft = 0;
  gameBudget.warn = false;
});

describe('Games mode', () => {
  it('appends the first game sub-route, then replaces it without duplicating the game id', () => {
    const first = resolvePath(gameSubRouteTarget(null, 'video-games'), '/games/hero').pathname;
    const switched = resolvePath(gameSubRouteTarget('video-games', 'tv-shows'), first).pathname;

    expect(first).toBe('/games/hero/video-games');
    expect(switched).toBe('/games/hero/tv-shows');
    expect(switched).not.toContain('/hero/hero/');
  });

  it('renders a picker tile per registered game with friendly labels (index route)', () => {
    renderGames();
    // 'card-game' is the registry id; every player-facing surface (tile,
    // breadcrumb, battle header) calls it Battle Stadium.
    for (const label of ['Battle Stadium', 'Space Invaders', 'Tetris', 'Flashcards', 'Piano Hero', 'Side Scroller']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('greys out the unreleased Battle Stadium tile while leaving every other game live', () => {
    renderGames();
    const tile = screen.getByText('Battle Stadium').closest('button');
    expect(tile.disabled).toBe(true);
    expect(tile.className).toContain('is-disabled');
    expect(tile.textContent).toContain('Preview');
    for (const label of ['Tetris', 'Piano Chess', 'Flashcards']) {
      expect(screen.getByText(label).closest('button').disabled).toBe(false);
    }
  });

  it('still reaches Battle Stadium by its direct route — the tile is the only thing closed', () => {
    // /games/card-game mounts GameHost, which never consults the picker.
    renderGames('/games/card-game');
    expect(screen.queryByText('Battle Stadium')).toBeNull(); // not the picker
    expect(document.querySelector('.piano-game-fullscreen')).not.toBeNull();
  });

  it('blocks a direct game route when the active learner has not completed school', async () => {
    schoolAccess.unlocked = false;
    renderGames('/games/tetris', 'learner1');
    expect(await screen.findByText('Games are locked')).toBeTruthy();
    expect(screen.getByText(/Finish today’s schoolwork/)).toBeTruthy();
    expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
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

  it('a game may carry one more url segment of its own', () => {
    // /piano/games/hero/video-games — the segment is the GAME's business (Piano
    // Hero uses it for the collection tab), but the router has to admit it or
    // the deep link cannot exist at all. Asserted against an unknown game so the
    // test does not depend on any real game's lazy chunk loading.
    renderGames('/games/nonexistent-game/some-tab');
    expect(screen.getByText(/Game not found/i)).toBeTruthy();
  });

  it('back from a sub-route returns to the picker, not to the game', () => {
    // Two segments deep, "up" still means out of the game — otherwise Back would
    // strand you on the game with no tab.
    renderGames('/games/nonexistent-game/some-tab');
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Space Invaders')).toBeTruthy();
  });
});

describe('Games mode — budget gate (gate 3, below the school lock)', () => {
  it('shows the learner-depleted lock and no game when the budget meter reports depleted', () => {
    gameBudget.state = 'depleted';
    renderGames('/games/tetris');
    expect(screen.getByText('Games are done for today')).toBeTruthy();
    expect(screen.getByText('You’ve used your piano game time for today. It comes back tomorrow.')).toBeTruthy();
    expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
  });

  it('shows the distinct device-depleted lock copy when the shared device budget is out', () => {
    gameBudget.state = 'device-depleted';
    renderGames('/games/tetris');
    expect(screen.getByText('The piano’s games are done for today')).toBeTruthy();
    expect(screen.getByText('This piano has reached its shared game time for the day.')).toBeTruthy();
    expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
  });

  it.each(['unavailable', 'off'])('fails open (renders the game) when the meter reports "%s"', (state) => {
    gameBudget.state = state;
    renderGames('/games/tetris');
    expect(document.querySelector('.piano-game-fullscreen')).not.toBeNull();
    expect(screen.queryByText('Games are done for today')).toBeNull();
    expect(screen.queryByText('The piano’s games are done for today')).toBeNull();
  });

  it('shows the non-blocking warning banner alongside the game when the meter reports warning', () => {
    gameBudget.state = 'warning';
    gameBudget.warn = true;
    gameBudget.secondsLeft = 125; // Math.ceil(125/60) === 3
    renderGames('/games/tetris');
    expect(document.querySelector('.piano-game-fullscreen')).not.toBeNull();
    expect(screen.getByText('3 min of game time left')).toBeTruthy();
  });
});
