import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, resolvePath, useNavigate } from 'react-router-dom';

const schoolAccess = vi.hoisted(() => ({ unlocked: true }));
const gameBudget = vi.hoisted(() => ({ state: 'off', secondsLeft: 0, warn: false }));
// vi.fn() (not a plain closure) so tests can assert what GameHost actually
// PASSES the hook — active/learnerId — not just what it renders in response
// to the hook's return value. A closure-only mock discards the call args
// entirely, which is exactly how the wiring bugs this file now pins (gate
// never activating because config.gameLimit isn't threaded through; the
// hydrated profile object sent as learnerId instead of the roster slug) shipped
// with 15/15 green the first time around.
const gameBudgetMeter = vi.hoisted(() => vi.fn());

// A stand-in for a real game. Every registered game is a lazy chunk that never
// resolves in this environment, so the match-boundary wiring — does the game
// REMOUNT on a rematch? does it see the context? — cannot be observed through
// one. `probe-game` is an ordinary component registered alongside the real
// registry (getGameIds is untouched, so the picker is exactly as it was) that
// counts its own mounts and exposes the context it was handed.
const probe = vi.hoisted(() => ({ mounts: 0, armed: null, sawContext: false }));
const gateProps = vi.hoisted(() => ({ last: null, mounts: 0 }));

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => Promise.resolve({ parsed: { games: {} } })),
}));
vi.mock('../../../gameRegistry.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { useContext, useEffect } = await import('react');
  const { default: MatchGateContext } = await import('./MatchGateContext.js');
  function ProbeGame() {
    const matchGate = useContext(MatchGateContext);
    probe.sawContext = matchGate !== null && matchGate !== undefined;
    probe.armed = matchGate?.armed ?? null;
    useEffect(() => { probe.mounts += 1; }, []);
    return (
      <div data-testid="probe-game">
        <button type="button" onClick={() => matchGate?.requestRematch()}>probe-rematch</button>
      </div>
    );
  }
  const entry = {
    id: 'probe-game', label: 'Probe Game', status: 'released', icon: 'game', LazyComponent: ProbeGame,
  };
  return { ...actual, getGameEntry: (id) => (id === 'probe-game' ? entry : actual.getGameEntry(id)) };
});
// The gate's own behaviour (ladder, material, fail-open) is pinned by
// GameGate.test.jsx. What is under test HERE is the host's state machine, so
// the gate is a stub with one button per terminal outcome.
vi.mock('./GameGate.jsx', () => ({
  default: (props) => {
    gateProps.last = props;
    return (
      <div data-testid="game-gate">
        <button type="button" onClick={() => props.onPassed({ score: 1 })}>gate-pass</button>
        <button type="button" onClick={() => props.onLeave()}>gate-leave</button>
      </div>
    );
  },
}));
vi.mock('../../useSchoolGameAccess.js', () => ({
  default: () => ({
    status: 'ready', state: schoolAccess.unlocked ? 'complete' : 'incomplete',
    unlocked: schoolAccess.unlocked, refresh: vi.fn(),
  }),
}));
vi.mock('../../useGameBudgetMeter.js', () => ({
  default: gameBudgetMeter,
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
// id lives in the URL; assertions check the right view per path. `config`
// defaults to testConfig (no gameLimit key) but a test can pass its own to
// exercise the gameLimit-enabled wiring.
/**
 * A way to drive real navigation from a test. `MemoryRouter.initialEntries` is
 * read once at mount, so re-rendering the tree with a different entry does not
 * move the router — the only honest way to exercise a route change under a
 * MOUNTED host is to navigate from inside it.
 */
function Navigator({ to }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(to)}>{`go:${to}`}</button>;
}

function renderGames(initialEntry = '/games', currentUser = 'guest', config = testConfig, navTargets = []) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ActivePianoProvider pianoId="test" config={config}>
        <PianoUserContext.Provider value={{ currentUser, currentProfile: { id: currentUser, name: currentUser } }}>
          <PianoMidiProvider>
            {navTargets.map((to) => <Navigator key={to} to={to} />)}
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
  gameBudgetMeter.mockImplementation(() => gameBudget);
  probe.mounts = 0;
  probe.armed = null;
  probe.sawContext = false;
  gateProps.last = null;
  // Which physical kiosk this browser is. Captured from the launch URL and
  // persisted; the host reads it rather than stamping a shared literal.
  localStorage.setItem('piano.kioskDeviceId', 'yellow-room-tablet');
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

  // These two pin the WIRING, not just the render: a mock that only returns a
  // fixed state can never catch either bug it exists to prevent — the gate
  // never activating because config.gameLimit isn't threaded through
  // resolvePianoConfig, or the hydrated profile object going out as
  // learnerId instead of the roster slug (which would silently pool every
  // child's play time into one bucket keyed "[object Object]").
  it('meters with active:true and the roster SLUG (not the hydrated profile object) when gameLimit is enabled', () => {
    renderGames('/games/tetris', 'learner1', { ...testConfig, gameLimit: { enabled: true } });
    expect(gameBudgetMeter).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      learnerId: 'learner1',
      deviceId: 'yellow-room-tablet',
    }));
  });

  it('does not meter (active:false) when gameLimit is absent from config', () => {
    renderGames('/games/tetris', 'learner1', testConfig);
    expect(gameBudgetMeter).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('does not meter (active:false) when gameLimit.enabled is explicitly false', () => {
    renderGames('/games/tetris', 'learner1', { ...testConfig, gameLimit: { enabled: false } });
    expect(gameBudgetMeter).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
  });

  it('stamps the device the meter is told about with THIS kiosk, not a shared literal', () => {
    // Two kiosks that both call themselves 'piano-kiosk' meter into one bucket,
    // so a device-wide daily cap is spent by whichever tablet is used first.
    localStorage.setItem('piano.kioskDeviceId', 'playroom-tablet');
    renderGames('/games/tetris', 'learner1', { ...testConfig, gameLimit: { enabled: true } });
    expect(gameBudgetMeter).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'playroom-tablet' }));
  });
});

// Gate 2: the playing challenge at a match boundary. It sits UNDER the school
// lock (gate 1, in Games()) and OVER the budget lock (gate 3) — passing it is
// what reaches a match, and only then does the day's budget have an opinion.
describe('Games mode — match gate (gate 2)', () => {
  const gatedConfig = { ...testConfig, gameGate: { enabled: true } };

  it('renders the gate INSTEAD of the game when the gate is enabled (D11: same route, game unmounted)', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    expect(screen.getByTestId('game-gate')).toBeTruthy();
    expect(screen.queryByTestId('probe-game')).toBeNull();
    expect(probe.mounts).toBe(0);
  });

  it('hands the gate the roster slug and the household gameGate block', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    expect(gateProps.last.learnerId).toBe('learner1');
    expect(gateProps.last.gateConfig).toEqual({ enabled: true });
  });

  it('mounts the game once the gate passes', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    fireEvent.click(screen.getByText('gate-pass'));
    expect(screen.getByTestId('probe-game')).toBeTruthy();
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(probe.mounts).toBe(1);
  });

  it('leaves the game entirely when the child taps Leave at the gate', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    fireEvent.click(screen.getByText('gate-leave'));
    // Back at the picker: the gate is not a wall you sit at.
    expect(screen.getByText('Space Invaders')).toBeTruthy();
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(probe.mounts).toBe(0);
  });

  it('re-arms the gate on requestRematch, and the next pass mounts a FRESH match', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    fireEvent.click(screen.getByText('gate-pass'));
    expect(probe.mounts).toBe(1);

    fireEvent.click(screen.getByText('probe-rematch'));
    expect(screen.getByTestId('game-gate')).toBeTruthy();
    expect(screen.queryByTestId('probe-game')).toBeNull();

    fireEvent.click(screen.getByText('gate-pass'));
    // A remount, not a re-render: the match is new, keyed by matchId.
    expect(probe.mounts).toBe(2);
  });

  it('tells the mounted game the gate is armed', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    fireEvent.click(screen.getByText('gate-pass'));
    expect(probe.sawContext).toBe(true);
    expect(probe.armed).toBe(true);
  });

  it('does not meter while the child is at the gate, and does once the match starts (D13)', () => {
    const config = { ...gatedConfig, gameLimit: { enabled: true } };
    renderGames('/games/probe-game', 'learner1', config);
    expect(gameBudgetMeter).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }));

    fireEvent.click(screen.getByText('gate-pass'));
    expect(gameBudgetMeter).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
  });

  it('never renders the gate when gameGate is absent — and a rematch still starts a fresh match', () => {
    renderGames('/games/probe-game', 'learner1', testConfig);
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(probe.mounts).toBe(1);
    expect(probe.sawContext).toBe(true);
    expect(probe.armed).toBe(false);

    fireEvent.click(screen.getByText('probe-rematch'));
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(probe.mounts).toBe(2);
  });

  it('never renders the gate when gameGate.enabled is explicitly false', () => {
    renderGames('/games/probe-game', 'learner1', { ...testConfig, gameGate: { enabled: false } });
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(screen.getByTestId('probe-game')).toBeTruthy();
    expect(probe.armed).toBe(false);
  });

  it('re-arms when the game changes under a mounted host', () => {
    // `:gameId` and `:gameId/:subRoute` render the same element, so React keeps
    // this host instance across a params change and the initial `useState` read
    // never runs again. A game→game move would otherwise walk into a match on a
    // gate passed for a different game.
    renderGames('/games/probe-game', 'learner1', gatedConfig, ['/games/tetris']);
    fireEvent.click(screen.getByText('gate-pass'));
    expect(probe.mounts).toBe(1);

    fireEvent.click(screen.getByText('go:/games/tetris'));
    expect(screen.getByTestId('game-gate')).toBeTruthy();
  });

  it('does not re-arm when only the game-owned sub-route changes', () => {
    // A game switching its own tab is not a match boundary — re-arming there
    // would put a challenge in front of every tab tap.
    renderGames('/games/probe-game', 'learner1', gatedConfig, ['/games/probe-game/some-tab']);
    fireEvent.click(screen.getByText('gate-pass'));

    fireEvent.click(screen.getByText('go:/games/probe-game/some-tab'));
    expect(screen.queryByTestId('game-gate')).toBeNull();
    expect(screen.getByTestId('probe-game')).toBeTruthy();
  });

  it('keeps the school lock strictly above the gate (gate 1 before gate 2)', () => {
    schoolAccess.unlocked = false;
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    expect(screen.getByText('Games are locked')).toBeTruthy();
    expect(screen.queryByTestId('game-gate')).toBeNull();
  });
});
