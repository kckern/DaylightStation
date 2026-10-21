import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, resolvePath, useNavigate } from 'react-router-dom';

const schoolAccess = vi.hoisted(() => ({
  unlocked: true, via: null, pass: null, offers: [], refreshes: 0, onRefresh: null,
}));
const gameBudget = vi.hoisted(() => ({ state: 'off', secondsLeft: 0, warn: false }));
const daylightApi = vi.hoisted(() => vi.fn(() => Promise.resolve({ parsed: { games: {} } })));
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
const probe = vi.hoisted(() => ({ mounts: 0, armed: null, sawContext: false, crash: false }));
const gateProps = vi.hoisted(() => ({ last: null, mounts: 0 }));
const gatePassResult = vi.hoisted(() => ({ value: { score: 1 } }));
const log = vi.hoisted(() => {
  const lines = [];
  const logger = {
    info: (event, data) => lines.push([event, data]),
    warn: (event, data) => lines.push([event, data]),
    error: (event, data) => lines.push([event, data]),
    debug: () => {}, sampled: () => {},
  };
  logger.child = () => logger;
  return { lines, logger };
});
vi.mock('../../../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => log.logger, getLogger: () => log.logger,
}));

// Keep the games-config fetch hermetic (no real network).
vi.mock('../../../../../../../frontend/src/lib/api.mjs', () => ({
  DaylightAPI: daylightApi,
}));
vi.mock('../../../gameRegistry.js', async (importOriginal) => {
  const actual = await importOriginal();
  const { useContext, useEffect, useState } = await import('react');
  const { default: MatchGateContext } = await import('./MatchGateContext.js');
  function ProbeGame({ onDeactivate }) {
    const matchGate = useContext(MatchGateContext);
    const [crashed, setCrashed] = useState(false);
    probe.sawContext = matchGate !== null && matchGate !== undefined;
    probe.armed = matchGate?.armed ?? null;
    useEffect(() => { probe.mounts += 1; }, []);
    if (crashed) throw new Error('probe fell over');
    return (
      <div data-testid="probe-game">
        <button type="button" onClick={() => matchGate?.requestRematch()}>probe-rematch</button>
        <button type="button" onClick={() => matchGate?.registerCompletion(Promise.resolve({}))}>probe-complete</button>
        <button type="button" onClick={() => onDeactivate()}>probe-exit</button>
        <button type="button" onClick={() => setCrashed(true)}>probe-crash</button>
      </div>
    );
  }
  const entry = {
    id: 'probe-game', label: 'Probe Game', status: 'released', icon: 'game', exerciseGate: true, LazyComponent: ProbeGame,
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
        <button type="button" onClick={() => props.onPassed(gatePassResult.value)}>gate-pass</button>
        <button type="button" onClick={() => props.onLeave()}>gate-leave</button>
      </div>
    );
  },
}));
// A vi.fn() (not a plain closure) so tests can assert what Games() actually
// PASSES the hook — specifically the `schoolLearner` escape-hatch option
// (2026-09-03: Games.jsx was the one call site that omitted it, so a grown-up
// School does not track queried an entitlement that does not exist for them
// and was told to finish schoolwork they never had). The mock mirrors the
// real hook's own `notGated` gate exactly, so these tests fail against the
// un-fixed call site instead of only exercising the stub.
//
// `refresh` really re-renders (a state bump) and runs `schoolAccess.onRefresh`
// first, so a test can say what the next read answers — a bought pass, a
// consumed one — exactly as the real hook would after its re-read.
vi.mock('../../useSchoolGameAccess.js', async () => {
  const { useCallback, useState } = await import('react');
  return {
    default: vi.fn((learnerId, opts) => {
      const [, bump] = useState(0);
      const refresh = useCallback(() => {
        schoolAccess.refreshes += 1;
        schoolAccess.onRefresh?.();
        bump((n) => n + 1);
      }, []);
      const notGated = opts?.schoolLearner === false && learnerId !== 'guest' && Boolean(learnerId);
      if (notGated) return { status: 'ready', state: 'not_gated', unlocked: true, refresh };
      const viaPass = !schoolAccess.unlocked && schoolAccess.via === 'pass';
      return {
        status: 'ready', state: schoolAccess.unlocked ? 'complete' : 'incomplete',
        unlocked: schoolAccess.unlocked || viaPass, ...(viaPass ? { via: 'pass' } : {}),
        pass: schoolAccess.pass, offers: schoolAccess.offers, refresh,
      };
    }),
  };
});
vi.mock('../../useGameBudgetMeter.js', () => ({
  default: gameBudgetMeter,
}));
// Profile loading is owned by its dedicated hook; Games tests stay focused on
// the match-boundary state machine and receive the ordinary no-placement case.
vi.mock('../../../ask/usePianoChallengeProfile.js', () => ({
  default: () => ({ loading: false, startLevel: null }),
}));

import { PianoMidiProvider } from '../../PianoMidiContext.jsx';
import { ActivePianoProvider } from '../../PianoConfig.jsx';
import PianoUserContext from '../../PianoUserContext.jsx';
import { Games } from './Games.jsx';
import { gameSubRouteTarget } from './gameSubRoute.js';

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

// `users` defaults to a single-entry roster with no `schoolLearner` field —
// exactly what every pre-existing test in this file was implicitly relying
// on (an unanswered/absent roster field), so their behaviour is unchanged.
// Pass an explicit roster to exercise the `schoolLearner` wiring itself.
function renderGames(
  initialEntry = '/games', currentUser = 'guest', config = testConfig, navTargets = [],
  users = [{ id: currentUser, name: currentUser }],
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ActivePianoProvider pianoId="test" config={config}>
        <PianoUserContext.Provider value={{ currentUser, currentProfile: { id: currentUser, name: currentUser }, users }}>
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
  daylightApi.mockImplementation(() => Promise.resolve({ parsed: { games: {} } }));
  schoolAccess.unlocked = true;
  schoolAccess.via = null;
  schoolAccess.pass = null;
  schoolAccess.offers = [];
  schoolAccess.refreshes = 0;
  schoolAccess.onRefresh = null;
  probe.crash = false;
  gameBudget.state = 'off';
  gameBudget.secondsLeft = 0;
  gameBudget.warn = false;
  gameBudgetMeter.mockImplementation(() => gameBudget);
  probe.mounts = 0;
  log.lines.length = 0;
  probe.armed = null;
  probe.sawContext = false;
  gateProps.last = null;
  gatePassResult.value = { score: 1 };
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

  describe('a player games are not offered to', () => {
    const offConfig = { ...testConfig, gameAccess: { disabledFor: ['kid-off'] } };

    it('closes the DIRECT route, not just the tile', () => {
      // The tile is the discoverable door; /piano/games/tetris is the one a
      // bookmark or a typed URL reaches. Hiding a tile is a decoration.
      renderGames('/games/tetris', 'kid-off', offConfig);
      expect(screen.getByText('Games are off')).toBeTruthy();
      expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
    });

    it('closes the picker too', () => {
      renderGames('/games', 'kid-off', offConfig);
      expect(screen.getByText('Games are off')).toBeTruthy();
    });

    it('says nothing about schoolwork — there is no route to unlock', () => {
      // A lock names the thing that would open it. This is not a lock, and
      // telling him to finish his schoolwork would be a promise the piano
      // cannot keep — he would go and keep his side of it.
      schoolAccess.unlocked = true;
      renderGames('/games/tetris', 'kid-off', offConfig);
      expect(screen.queryByText(/schoolwork/i)).toBeNull();
      expect(screen.queryByText('Games are locked')).toBeNull();
    });

    it('holds even once the schoolwork IS done — this does not expire', () => {
      schoolAccess.unlocked = true;
      renderGames('/games/tetris', 'kid-off', offConfig);
      expect(screen.getByText('Games are off')).toBeTruthy();
    });

    it('leaves every other player alone', () => {
      renderGames('/games/tetris', 'learner1', offConfig);
      expect(screen.queryByText('Games are off')).toBeNull();
      expect(document.querySelector('.piano-game-fullscreen')).not.toBeNull();
    });
  });

  // 2026-09-03 regression: Games() is the one call site of useSchoolGameAccess
  // that omitted the `schoolLearner` escape-hatch option, so a grown-up School
  // does not track queried an entitlement that does not exist for them,
  // read as `indeterminate`, and stayed locked out of Games entirely.
  describe('school-access wiring (grown-up escape hatch)', () => {
    it('reaches the game for a roster member marked schoolLearner: false, even while the entitlement read would otherwise lock', () => {
      // schoolAccess.unlocked = false simulates the indeterminate/incomplete
      // verdict a person with no piano.games gate instance actually gets back
      // — the exact shape of the reported bug. `notGated` must bypass it.
      schoolAccess.unlocked = false;
      renderGames('/games/tetris', 'kckern', testConfig, [], [{ id: 'kckern', name: 'KC', schoolLearner: false }]);
      expect(document.querySelector('.piano-game-fullscreen')).not.toBeNull();
      expect(screen.queryByText('Games are locked')).toBeNull();
    });

    it('still locks a roster member marked schoolLearner: true with incomplete schoolwork — the gate is not a no-op', () => {
      schoolAccess.unlocked = false;
      renderGames('/games/tetris', 'learner1', testConfig, [], [{ id: 'learner1', name: 'Learner One', schoolLearner: true }]);
      expect(screen.getByText('Games are locked')).toBeTruthy();
      expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
    });

    it('stays locked while the roster has not yet answered whether this user is a school learner (schoolLearner undefined)', () => {
      // An empty roster is the race window between "identity picked" and
      // "roster fetch resolved". Racing it must never be a reliable unlock
      // for a child with unfinished schoolwork.
      schoolAccess.unlocked = false;
      renderGames('/games/tetris', 'learner1', testConfig, [], []);
      expect(screen.getByText('Games are locked')).toBeTruthy();
      expect(document.querySelector('.piano-game-fullscreen')).toBeNull();
    });
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

  it('records game.mount for ANY game, once the chunk is really on screen', () => {
    // This lived in the addressed-board family, so two of nine games logged a
    // mount and the rest logged nothing — and "did the game the child asked
    // for ever appear?" was unanswerable for Chess, Space Invaders and Tetris.
    // probe-game is in no family at all, which is the point of asserting here.
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    expect(log.lines.some(([event]) => event === 'game.mount')).toBe(false);

    fireEvent.click(screen.getByText('gate-pass'));
    const mount = log.lines.find(([event]) => event === 'game.mount');
    expect(mount).toBeTruthy();
    expect(mount[1]).toMatchObject({ game: 'probe-game', learnerId: 'learner1', matchId: expect.any(Number) });
  });

  it('records game.unmount with how long the match lasted, so a bounce is visible', () => {
    renderGames('/games/probe-game', 'learner1', gatedConfig);
    fireEvent.click(screen.getByText('gate-pass'));
    fireEvent.click(screen.getByText('probe-rematch'));

    const unmount = log.lines.find(([event]) => event === 'game.unmount');
    expect(unmount).toBeTruthy();
    expect(unmount[1].game).toBe('probe-game');
    expect(unmount[1].playedMs).toBeGreaterThanOrEqual(0);
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

  it('posts a completed passed assessment to the earned-time endpoint without making a credit failure a new gate', () => {
    gatePassResult.value = { assessmentId: 'attempt-42', score: 0.8, status: 'completed' };
    renderGames('/games/probe-game', 'learner1', {
      ...gatedConfig,
      gameLimit: { enabled: true, source: 'earned' },
    });
    fireEvent.click(screen.getByText('gate-pass'));
    expect(daylightApi).toHaveBeenCalledWith(
      'api/v1/piano/users/learner1/game-budget/credits',
      { assessmentId: 'attempt-42', score: 0.8, status: 'completed', passed: true },
      'POST',
    );
    expect(screen.getByTestId('probe-game')).toBeTruthy();
  });
});

// The early pass (school economy slice 1, C5): one game a day before school
// is done, bought at the lock, consumed when the game ends, refunded inside a
// minute. Economy's side is pinned in economy.test.mjs; this is the kiosk's.
describe('Games mode — early pass', () => {
  // A second pass of the day, so the id has both the colons and the `.2`
  // that must survive the path.
  const PASS_ID = 'pass:learner1:2026-10-21.2';
  const ENCODED = encodeURIComponent(PASS_ID);
  const SILVER = { coin: 'silver', price: 3, affordable: true };
  const GOLD_SHORT = { coin: 'gold', price: 1, affordable: false };
  let now;
  let buyError;
  let refundError;

  const posts = (suffix) => daylightApi.mock.calls.filter(([path, , method]) => method === 'POST' && String(path).endsWith(suffix));
  const terminalCalls = () => [...posts('/consume'), ...posts('/refund')];
  const activePass = () => ({ passId: PASS_ID, state: 'active', capUsed: true, coin: 'silver', paid: 3 });
  const locked = (pass = { passId: null, state: 'none', capUsed: false }, offers = [SILVER, GOLD_SHORT]) => {
    schoolAccess.unlocked = false;
    schoolAccess.via = null;
    schoolAccess.pass = pass;
    schoolAccess.offers = offers;
  };
  const withActivePass = () => {
    locked(activePass(), []);
    schoolAccess.via = 'pass';
    // What the next read answers once the pass is spent.
    schoolAccess.onRefresh = () => locked({ ...activePass(), state: 'consumed' }, []);
  };
  const httpError = (status, body) => Object.assign(
    new Error(`HTTP ${status}: Refused - ${JSON.stringify(body)}`), { status },
  );

  beforeEach(async () => {
    // A host unmounted by the previous test's cleanup settles its pass one
    // tick later (the StrictMode-safe defer). Let that land before counting.
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    daylightApi.mockClear();
    log.lines.length = 0;
    schoolAccess.refreshes = 0;
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    buyError = null;
    refundError = null;
    daylightApi.mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith('/completion')) {
        return { state: 'incomplete', sections: [{ state: 'served' }, { state: 'obligated' }, { state: 'obligated' }, { state: 'excused' }] };
      }
      if (p.endsWith('/next')) return { subject: 'math', unit: { unitId: 'math-4-02', title: 'Math 4-02' }, printable: true, reward: null };
      if (p.endsWith('/print-next')) return { sentence: 'Your sheet is printing.' };
      if (p.endsWith('/passes')) {
        if (buyError) throw buyError;
        return { pass: { passId: PASS_ID, state: 'active' } };
      }
      if (p.endsWith('/consume')) return { duplicate: false };
      if (p.endsWith('/refund')) {
        if (refundError) throw refundError;
        return { refunded: 3, duplicate: false };
      }
      return { parsed: { games: {} } };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('the lock offers what the child can afford, today’s progress, and the next sheet', async () => {
    locked();
    renderGames('/games/probe-game', 'learner1');
    expect(screen.getByText('Games are locked')).toBeTruthy();
    expect(screen.getByText('Finish today’s schoolwork to unlock Games.')).toBeTruthy();
    expect(await screen.findByText('School: 1 of 3 done today')).toBeTruthy();
    expect(screen.getByText('Spend 3 silver: one game')).toBeTruthy();
    // Gold is quoted but not affordable: no button, rather than one that fails.
    expect(screen.queryByText(/Spend 1 gold/)).toBeNull();
    // `reward: null` in production: no amount is invented.
    const print = await screen.findByText('Print my next sheet (Math 4-02)');
    expect(screen.queryByText(/\+\d+ silver/)).toBeNull();

    fireEvent.click(print);
    expect(await screen.findByText('Your sheet is printing.')).toBeTruthy();
    expect(posts('/print-next')[0]).toEqual([
      'api/v1/school/self-service/learners/learner1/print-next', { deviceId: 'yellow-room-tablet' }, 'POST',
    ]);
    expect(log.lines.some(([event]) => event === 'piano.early-pass.offered')).toBe(true);
  });

  it('buying asks first, then posts, re-reads access and opens the game', async () => {
    locked();
    schoolAccess.onRefresh = () => {
      schoolAccess.via = 'pass';
      schoolAccess.pass = activePass();
      schoolAccess.offers = [];
    };
    renderGames('/games/probe-game', 'learner1');
    fireEvent.click(screen.getByText('Spend 3 silver: one game'));
    expect(screen.getByText('One game, then games lock until school is done')).toBeTruthy();
    expect(posts('/passes')).toHaveLength(0);

    fireEvent.click(screen.getByText('Yes, spend 3 silver'));
    expect(await screen.findByTestId('probe-game')).toBeTruthy();
    expect(posts('/passes')[0]).toEqual([
      'api/v1/economy/users/learner1/passes', { privilege: 'piano.games', coin: 'silver' }, 'POST',
    ]);
    expect(schoolAccess.refreshes).toBe(1);
    // A pass game reports armed, so its "play again" comes back to the host.
    expect(probe.armed).toBe(true);
    expect(log.lines.some(([event]) => event === 'piano.early-pass.bought')).toBe(true);
  });

  it('a refused buy shows the shortfall, and still re-reads the bank', async () => {
    locked();
    buyError = httpError(402, { code: 'PASS_UNAFFORDABLE', coin: 'silver', price: 3, balance: 1, shortfall: 2 });
    renderGames('/games/probe-game', 'learner1');
    fireEvent.click(screen.getByText('Spend 3 silver: one game'));
    fireEvent.click(screen.getByText('Yes, spend 3 silver'));
    expect(await screen.findByText('2 more silver to buy a game.')).toBeTruthy();
    expect(schoolAccess.refreshes).toBe(1);
    expect(log.lines.find(([event]) => event === 'piano.early-pass.refused')[1]).toMatchObject({ action: 'buy', code: 'PASS_UNAFFORDABLE' });
  });

  it('a cap refusal says the sneak is used', async () => {
    locked();
    buyError = httpError(409, { code: 'PASS_CAP' });
    renderGames('/games/probe-game', 'learner1');
    fireEvent.click(screen.getByText('Spend 3 silver: one game'));
    fireEvent.click(screen.getByText('Yes, spend 3 silver'));
    expect(await screen.findByText('Sneak used today — finish school to play more.')).toBeTruthy();
    expect(schoolAccess.refreshes).toBe(1);
  });

  it('once the cap is used, says so and sells nothing', () => {
    locked({ passId: PASS_ID, state: 'consumed', capUsed: true }, [SILVER]);
    renderGames('/games/probe-game', 'learner1');
    expect(screen.getByText('Sneak used today — finish school to play more.')).toBeTruthy();
    expect(screen.queryByText(/Spend \d+/)).toBeNull();
  });

  it('an unreadable ledger sells nothing and claims nothing', () => {
    locked({ passId: null, state: 'unknown', capUsed: null }, [SILVER]);
    renderGames('/games/probe-game', 'learner1');
    expect(screen.queryByText(/Spend \d+/)).toBeNull();
    expect(screen.queryByText(/Sneak used/)).toBeNull();
  });

  it('completion consumes once the save resolves, keeps the result up, then the next match relocks', async () => {
    withActivePass();
    renderGames('/games/probe-game', 'learner1');
    expect(screen.getByTestId('probe-game')).toBeTruthy();
    now += 120_000;

    fireEvent.click(screen.getByText('probe-complete'));
    await waitFor(() => expect(posts('/consume')).toHaveLength(1));
    expect(posts('/consume')[0]).toEqual([`api/v1/economy/users/learner1/passes/${ENCODED}/consume`, { playedMs: 120_000 }, 'POST']);
    // The consume's refresh reads locked; the finished game stays on screen.
    await waitFor(() => expect(schoolAccess.refreshes).toBe(1));
    expect(screen.getByTestId('probe-game')).toBeTruthy();

    fireEvent.click(screen.getByText('probe-rematch'));
    expect(await screen.findByText('Good game!')).toBeTruthy();
    expect(screen.getByText('Games lock again until school is done.')).toBeTruthy();
    expect(await screen.findByText('Print my next sheet (Math 4-02)')).toBeTruthy();
    expect(screen.queryByTestId('probe-game')).toBeNull();
    expect(probe.mounts).toBe(1);
    expect(terminalCalls()).toHaveLength(1);
    expect(log.lines.some(([event]) => event === 'piano.early-pass.consumed')).toBe(true);
  });

  it('an exit 30 s in refunds and relocks — never a remount, never the picker', async () => {
    withActivePass();
    renderGames('/games/probe-game', 'learner1');
    now += 30_000;
    fireEvent.click(screen.getByText('probe-exit'));
    expect(await screen.findByText('Good game!')).toBeTruthy();
    await waitFor(() => expect(posts('/refund')).toHaveLength(1));
    expect(posts('/refund')[0]).toEqual([`api/v1/economy/users/learner1/passes/${ENCODED}/refund`, { playedMs: 30_000, reason: 'exit' }, 'POST']);
    expect(await screen.findByText('Your coins are back.')).toBeTruthy();
    expect(screen.queryByText('Space Invaders')).toBeNull();
    expect(posts('/consume')).toHaveLength(0);
  });

  it('an exit after a minute consumes', async () => {
    withActivePass();
    renderGames('/games/probe-game', 'learner1');
    now += 90_000;
    fireEvent.click(screen.getByText('probe-exit'));
    await waitFor(() => expect(posts('/consume')).toHaveLength(1));
    expect(posts('/consume')[0][1]).toEqual({ playedMs: 90_000 });
    expect(posts('/refund')).toHaveLength(0);
  });

  it('a refund the server refuses as closed consumes once instead, and does not retry', async () => {
    withActivePass();
    refundError = httpError(409, { code: 'PASS_REFUND_CLOSED' });
    renderGames('/games/probe-game', 'learner1');
    now += 20_000;
    fireEvent.click(screen.getByText('probe-exit'));
    await waitFor(() => expect(posts('/consume')).toHaveLength(1));
    expect(posts('/refund')).toHaveLength(1);
    expect(log.lines.find(([event]) => event === 'piano.early-pass.refused')[1]).toMatchObject({ action: 'refund', code: 'PASS_REFUND_CLOSED' });
  });

  it('a crash refunds, and leaving the crash card relocks without a second call', async () => {
    withActivePass();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderGames('/games/probe-game', 'learner1');
    now += 10_000;
    fireEvent.click(screen.getByText('probe-crash'));
    expect(screen.getByText('Probe Game stopped.')).toBeTruthy();
    await waitFor(() => expect(posts('/refund')).toHaveLength(1));
    expect(posts('/refund')[0][1]).toEqual({ playedMs: 10_000, reason: 'crash' });

    fireEvent.click(screen.getByText('Back to games'));
    expect(await screen.findByText('Good game!')).toBeTruthy();
    expect(terminalCalls()).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('leaving the game by the route (not the host) still settles it, once', async () => {
    withActivePass();
    renderGames('/games/probe-game', 'learner1', testConfig, ['/games']);
    now += 5_000;
    fireEvent.click(screen.getByText('go:/games'));
    await waitFor(() => expect(posts('/refund')).toHaveLength(1));
    expect(posts('/refund')[0][1]).toEqual({ playedMs: 5_000, reason: 'unmount' });
    expect(await screen.findByText('Good game!')).toBeTruthy();
    expect(terminalCalls()).toHaveLength(1);
  });

  it('a pass that never reached a game refunds 0 ms when the child leaves the challenge', async () => {
    withActivePass();
    renderGames('/games/probe-game', 'learner1', { ...testConfig, gameGate: { enabled: true } });
    expect(screen.getByTestId('game-gate')).toBeTruthy();
    now += 40_000;
    fireEvent.click(screen.getByText('gate-leave'));
    await waitFor(() => expect(posts('/refund')).toHaveLength(1));
    expect(posts('/refund')[0][1]).toEqual({ playedMs: 0, reason: 'exit' });
  });

  it('a player games are not offered to is never offered a pass', () => {
    locked();
    renderGames('/games/probe-game', 'kid-off', { ...testConfig, gameAccess: { disabledFor: ['kid-off'] } });
    expect(screen.getByText('Games are off')).toBeTruthy();
    expect(screen.queryByText(/Spend \d+/)).toBeNull();
    expect(screen.queryByText(/Print my next sheet/)).toBeNull();
    expect(daylightApi.mock.calls.some(([path]) => /completion|economy|self-service/.test(String(path)))).toBe(false);
  });

  it('a school-unlocked game is untouched by any of it', async () => {
    renderGames('/games/probe-game', 'learner1');
    expect(probe.armed).toBe(false);
    fireEvent.click(screen.getByText('probe-exit'));
    expect(screen.getByText('Space Invaders')).toBeTruthy();
    expect(terminalCalls()).toHaveLength(0);
  });
});
