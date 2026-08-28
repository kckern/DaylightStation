// The gate is only worth standing if every road back into a match goes past it
// (D12). Two things are pinned here:
//
//  1. the hook's own contract — armed, unarmed, no provider, not-a-boundary;
//  2. that each game's replay path is ACTUALLY routed through it. That second
//     half is the one that matters: the hook can be perfect and the constraint
//     still broken, because a game that never calls it replays forever on a
//     gate it paid once. Each game is mounted for real with its game hook
//     doubled into a finished state, and the replay callback the game handed
//     `useAnyKeyToContinue` is the thing invoked — not a callback this file
//     made up.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import MatchGateContext from '../../PianoKiosk/modes/Games/MatchGateContext.js';
import { useMatchRematch } from './useMatchRematch.js';

const h = vi.hoisted(() => ({
  continues: {},
  start: vi.fn(),
  heroPhase: 'complete',
}));

// Every game's replay entry point arrives here; capture it per game id rather
// than simulating held notes in four different engines.
vi.mock('../input/useAnyKeyToContinue.js', () => {
  const capture = (args) => { h.continues[args.gameId ?? 'last'] = args; };
  return { useAnyKeyToContinue: capture, default: capture };
});

const EMPTY_BOARD = Array.from({ length: 20 }, () => Array(10).fill(null));

vi.mock('../../PianoTetris/useTetrisGame.js', () => ({
  useTetrisGame: () => ({
    phase: 'GAME_OVER', startGame: h.start, board: EMPTY_BOARD, targets: null,
    matchedActions: new Set(), score: 0, linesCleared: 0, level: 0, countdown: null,
    currentPiece: null, ghostPiece: null, nextPiece: null, heldPiece: null,
    holdUsed: false, activeNoteRange: null, spawnCount: 0,
  }),
}));
vi.mock('../../PianoSpaceInvaders/useSpaceInvadersGame.js', () => ({
  useSpaceInvadersGame: () => ({
    gameState: 'VICTORY', startGame: h.start, failReason: null, score: 0, health: 3,
    levelIndex: 0, countdown: null, fallingNotes: [], wrongNotes: new Set(),
    destroyedKeys: new Map(), currentLevel: null, levelProgress: null,
  }),
}));
vi.mock('../../SideScrollerGame/useSideScrollerGame.js', async () => {
  const { DEFAULT_THEME } = await import('../../SideScrollerGame/sideScrollerTheme.js');
  return { useSideScrollerGame: () => ({
    phase: 'GAME_OVER', startGame: h.start, score: 0, level: 0, health: 3, distance: 0,
    targets: null, matchedActions: new Set(), obstacles: [], countdown: null,
    world: { invincibleUntil: 0, playerState: 'running', playerY: 0, worldPos: 0, obstacles: [] },
    nextObstacleType: null, theme: DEFAULT_THEME,
  }) };
});
vi.mock('../../PianoFlashcards/useFlashcardGame.js', () => ({
  useFlashcardGame: () => ({
    phase: 'COMPLETE', startGame: h.start, score: 0, level: 0, attempts: [],
    card: null, targets: null, matchedActions: new Set(), stats: null,
  }),
}));
vi.mock('../../PianoHeroGame/usePianoHeroGame.js', () => ({
  usePianoHeroGame: () => ({
    phase: h.heroPhase, start: h.start, elapsedMs: 0,
    timing: { fallDurationMs: 2000 },
    run: { targets: [], score: { points: 0, combo: 0, perfect: 0, good: 0, misses: 0, maxCombo: 0 } },
  }),
}));
// Flashcards reads a per-user preference on mount; keep it off the network.
vi.mock('../../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({})),
  DaylightAPIText: vi.fn(async () => ''),
}));

const { default: PianoTetris } = await import('../../PianoTetris/PianoTetris.jsx');
const { SpaceInvadersGame } = await import('../../PianoSpaceInvaders/SpaceInvadersGame.jsx');
const { SideScrollerGame } = await import('../../SideScrollerGame/SideScrollerGame.jsx');
const { PianoFlashcards } = await import('../../PianoFlashcards/PianoFlashcards.jsx');
const { HeroGame } = await import('../../PianoHeroGame/PianoHeroGame.jsx');

const HERO_CHART = {
  startNote: 60, endNote: 72, tempo: 90, durationMs: 4000, leadInMs: 0,
  targets: [], source: { id: 'song-1' },
};

/** Mount `element` with a gate context (or none) and hand back what it captured. */
function mountWith(element, matchGate) {
  h.continues = {};
  h.start.mockClear();
  const tree = matchGate === undefined
    ? element
    : <MatchGateContext.Provider value={matchGate}>{element}</MatchGateContext.Provider>;
  const view = render(tree);
  return view;
}

const GAMES = [
  ['tetris', () => <PianoTetris activeNotes={new Map()} />],
  ['space-invaders', () => <SpaceInvadersGame activeNotes={new Map()} noteHistory={[]} />],
  ['side-scroller', () => <SideScrollerGame activeNotes={new Map()} />],
  ['flashcards', () => <PianoFlashcards activeNotes={new Map()} />],
  // `runStarted` is hero's boundary signal — a run has already happened this
  // visit, so this start is a replay. It is owned by PianoHeroGame so it
  // survives the song picker remounting HeroGame; that half is pinned by
  // PianoHeroGame.rematch.test.jsx, which drives the real picker.
  ['hero', () => (
    <HeroGame
      song={{ id: 'song-1', title: 'Song' }} chart={HERO_CHART}
      gameConfig={{ noteSelect: false }} runStarted
    />
  )],
];

beforeEach(() => {
  h.heroPhase = 'complete';
  h.start.mockClear();
});

describe('useMatchRematch', () => {
  function probe(matchGate, isBoundary) {
    const seen = { current: null };
    function Probe() {
      seen.current = useMatchRematch(local, isBoundary);
      return null;
    }
    const local = vi.fn((...args) => `local:${args.join(',')}`);
    const tree = matchGate === undefined
      ? <Probe />
      : <MatchGateContext.Provider value={matchGate}>{<Probe />}</MatchGateContext.Provider>;
    const view = render(tree);
    return { seen, local, view };
  }

  it('tells an ARMED host instead of restarting locally', () => {
    const requestRematch = vi.fn();
    const { seen, local } = probe({ armed: true, requestRematch });
    act(() => { seen.current(); });
    expect(requestRematch).toHaveBeenCalledTimes(1);
    expect(local).not.toHaveBeenCalled();
  });

  it('restarts locally when the gate is present but unarmed, passing args and result through', () => {
    const requestRematch = vi.fn();
    const { seen, local } = probe({ armed: false, requestRematch });
    let returned;
    act(() => { returned = seen.current('a', 'b'); });
    expect(requestRematch).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledWith('a', 'b');
    expect(returned).toBe('local:a,b');
  });

  it('restarts locally with NO provider at all — the office screen behaves as it always has', () => {
    const { seen, local } = probe(undefined);
    act(() => { seen.current(); });
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('does not gate a call that is not a match boundary, even when armed', () => {
    // Hero's "Play" from the ready screen: the gate was paid on the way in.
    const requestRematch = vi.fn();
    const { seen, local } = probe({ armed: true, requestRematch }, false);
    act(() => { seen.current(); });
    expect(requestRematch).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledTimes(1);
  });

  it('keeps a stable identity across re-renders — listeners are armed on it', () => {
    const { seen, view } = probe({ armed: false, requestRematch: vi.fn() });
    const first = seen.current;
    view.rerender(
      <MatchGateContext.Provider value={{ armed: false, requestRematch: vi.fn() }}>
        <div />
      </MatchGateContext.Provider>,
    );
    expect(seen.current).toBe(first);
  });
});

describe('every game routes its replay through the gate (D12)', () => {
  it.each(GAMES)('%s asks an armed host rather than starting a new run itself', (id, element) => {
    const requestRematch = vi.fn();
    mountWith(element(), { armed: true, requestRematch });
    const captured = Object.values(h.continues).at(-1);
    expect(captured, `${id} never wired an any-key replay path`).toBeTruthy();

    act(() => { captured.onContinue(); });
    expect(requestRematch, `${id} replayed without asking the host`).toHaveBeenCalledTimes(1);
    expect(h.start, `${id} started a run behind the gate`).not.toHaveBeenCalled();
  });

  it.each(GAMES)('%s starts its own run when no gate is mounted', (id, element) => {
    mountWith(element(), undefined);
    const captured = Object.values(h.continues).at(-1);
    act(() => { captured.onContinue(); });
    expect(h.start, `${id} stopped restarting itself outside the kiosk`).toHaveBeenCalledTimes(1);
  });

  it('lets Piano Hero start the first run of a visit without paying the gate twice', () => {
    // No run yet this visit (`runStarted` unset) — the gate stood at game entry
    // and that pass buys exactly one run, whichever song it is spent on.
    h.heroPhase = 'ready';
    const requestRematch = vi.fn();
    mountWith(
      <HeroGame song={{ id: 'song-1', title: 'Song' }} chart={HERO_CHART} gameConfig={{ noteSelect: false }} />,
      { armed: true, requestRematch },
    );
    const captured = Object.values(h.continues).at(-1);
    act(() => { captured.onContinue(); });
    expect(requestRematch).not.toHaveBeenCalled();
    expect(h.start).toHaveBeenCalledTimes(1);
  });
});
