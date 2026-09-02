import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  archiveGame: vi.fn(),
  beaconArchive: vi.fn(() => true),
  saveGameRecord: vi.fn(async () => ({ ladder: { promoted: true } })),
}));

import { useChessPersistenceLifecycle } from './useChessPersistenceLifecycle.js';

const move = { at: 20, san: 'e4', from: 'e2', to: 'e4', color: 'w', chords: ['Em', 'Eadd9'] };
const game = (gameOver = false, plies = 1) => ({
  game: { fen: 'final-fen' },
  initialFen: 'initial-fen',
  history: Array.from({ length: plies }, () => move),
  undoneHistory: [],
  playerColor: 'w',
  scheme: { id: 'chords' },
  status: gameOver
    ? { game_over: true, outcome: 'checkmate', winner: 'w' }
    : { game_over: false, turn: 'b' },
});

const props = (currentGame, overrides = {}) => ({
  game: currentGame,
  gameId: 'game-1',
  userId: 'learner4',
  rungId: 'learner',
  ladderLevel: 2,
  ladderReady: true,
  addressing: 'chords',
  opponentRef: { current: { id: 'practice-opponent' } },
  helpUsed: { hints: 1, bestMoves: 0, takebacks: 0 },
  timing: { mode: 'off' },
  playerColor: 'w',
  logger: { info: vi.fn(), warn: vi.fn() },
  gateway: api,
  ...overrides,
});

/**
 * A match this component actually WATCHED get played: mounted while the board
 * was still playable, and present for the ply before its last. Rendering
 * straight into a finished board is the shape of a phantom, not of a game — see
 * docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
 */
function renderPlayedGame(overrides = {}) {
  const utils = renderHook(
    ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
    { initialProps: { currentGame: game(false, 21), ...overrides } },
  );
  act(() => utils.rerender({ currentGame: game(true, 22), ...overrides }));
  return utils;
}

describe('useChessPersistenceLifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists and archives one completed game from one set of facts', async () => {
    const { result } = renderPlayedGame();
    // WAIT FOR THE OUTCOME, NOT FOR THE CALL. `ladderOutcome` is set from the
    // save's own continuation — a promise hop and then a React commit — after
    // `saveGameRecord` has already been CALLED. A wait that stops at "it was
    // called" can therefore read `null` and report a hook that never stored the
    // ladder. That is the whole of the flake: the hook was always right, the
    // wait was one settlement short, and a machine under load lost the race.
    await waitFor(() => expect(result.current.ladderOutcome).toEqual({ promoted: true }));
    expect(api.saveGameRecord).toHaveBeenCalledOnce();
    expect(api.archiveGame).toHaveBeenCalledOnce();
    expect(result.current.finishedRecord).toMatchObject({ result: 'win', level: 2 });
  });

  it('re-arms abandoned-game archival when a new game starts', () => {
    const { rerender, unmount } = renderHook(
      ({ gameId }) => useChessPersistenceLifecycle(props(game(false), { gameId })),
      { initialProps: { gameId: 'game-1' } },
    );
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(api.beaconArchive).toHaveBeenCalledOnce();

    rerender({ gameId: 'game-2' });
    unmount();
    expect(api.archiveGame).toHaveBeenCalledOnce();
  });

  it('does not archive a BFCache suspension', () => {
    const { unmount } = renderHook(() => useChessPersistenceLifecycle(props(game(false))));
    const event = new Event('pagehide');
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => window.dispatchEvent(event));
    expect(api.beaconArchive).not.toHaveBeenCalled();
    unmount();
    expect(api.archiveGame).toHaveBeenCalledOnce();
  });

  it('ignores a previous game promotion response after restart', async () => {
    let resolveFirst;
    api.saveGameRecord.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result, rerender } = renderPlayedGame({ gameId: 'game-1' });
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());

    rerender({ currentGame: game(false), gameId: 'game-2' });
    await act(async () => resolveFirst({ ladder: { promoted: true } }));
    expect(result.current.ladderOutcome).toBe(null);
    expect(result.current.finishedRecord).toBe(null);
  });

  it('does not update state from a save that resolves after unmount', async () => {
    let resolveSave;
    api.saveGameRecord.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { unmount } = renderPlayedGame();
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    unmount();
    await act(async () => resolveSave({ ladder: { promoted: true } }));
  });

  it('archives a guest completion without writing a per-user record', () => {
    renderPlayedGame({ userId: null });
    expect(api.saveGameRecord).not.toHaveBeenCalled();
    expect(api.archiveGame).toHaveBeenCalledOnce();
  });

  it('does not archive an untouched game', () => {
    const untouched = { ...game(false), history: [] };
    const { unmount } = renderHook(() => useChessPersistenceLifecycle(props(untouched)));
    unmount();
    expect(api.archiveGame).not.toHaveBeenCalled();
  });
});

/**
 * A finished transcript that this component never watched get played is not its
 * game to report on. On 2026-08-25..27 five such phantoms reached one child's
 * chess history — same move count as a real game earlier that day, `level: null`,
 * `rung: learner`, `opponent: null`, and three to six seconds of "play". The
 * route that made them (resuming a terminal session) is closed at the authority;
 * this is the second lock, on the filing itself.
 */
describe('a match this component never watched', () => {
  beforeEach(() => vi.clearAllMocks());

  const renderPhantom = (overrides = {}) => renderHook(
    ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
    { initialProps: { currentGame: game(false, 0), ...overrides } },
  );

  it('refuses a finished board that arrived already over', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { rerender } = renderPhantom({ logger });
    act(() => rerender({ currentGame: game(true, 21), logger }));
    expect(api.saveGameRecord).not.toHaveBeenCalled();
    expect(api.archiveGame).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('game-record-refused', expect.objectContaining({
      plies: 21, watchedPlies: 0, reason: 'not-played-here',
    }));
  });

  it('complains once about one phantom, not once per re-judgement', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { rerender } = renderPhantom({ logger });
    act(() => rerender({ currentGame: game(true, 21), logger }));
    // The player lock is released once a game is over, so a profile switch on
    // top of a phantom board is an ordinary thing to do — and it judges the
    // same phantom again. A warning that cries wolf is one nobody reads.
    act(() => rerender({ currentGame: game(true, 21), logger, userId: 'ada' }));
    expect(logger.warn.mock.calls.filter(([event]) => event === 'game-record-refused')).toHaveLength(1);
  });

  it('leaves the one-shot open, so a game really played afterwards still files', async () => {
    const { rerender } = renderPhantom();
    act(() => rerender({ currentGame: game(true, 21) }));
    expect(api.saveGameRecord).not.toHaveBeenCalled();
    // The same mount, now actually playing: a refusal judged the transcript, not
    // the session, so this one is filed.
    act(() => rerender({ currentGame: game(false, 3) }));
    act(() => rerender({ currentGame: game(true, 4) }));
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
  });

  it('refuses to re-file the same finished board under a new game id', async () => {
    const { rerender } = renderPlayedGame({ gameId: 'game-1' });
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    // The identity moved on while the terminal board was still mounted — the
    // duplicate-write shape that produced the phantom records.
    act(() => rerender({ currentGame: game(true, 22), gameId: 'game-2' }));
    expect(api.saveGameRecord).toHaveBeenCalledOnce();
    expect(api.archiveGame).toHaveBeenCalledOnce();
  });

  it('refuses to file a phantom as an abandoned transcript either', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { rerender, unmount } = renderPhantom({ logger });
    act(() => rerender({ currentGame: game(true, 21), logger }));
    unmount();
    expect(api.archiveGame).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('game-abandon-refused', expect.objectContaining({
      plies: 21, reason: 'not-played-here',
    }));
  });
});

/**
 * A result must not be filed against a rung nobody is on. Chess writes
 * `level: null` when the ladder has not answered, which the shared ladder
 * refuses to count — so a slow read costs a genuinely played game its
 * promotion. Wait for the answer.
 */
describe('the ladder rung', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for the ladder read before filing, then files against the answered rung', async () => {
    const { rerender } = renderHook(
      ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
      { initialProps: { currentGame: game(false, 21), ladderReady: false, ladderLevel: null } },
    );
    act(() => rerender({ currentGame: game(true, 22), ladderReady: false, ladderLevel: null }));
    expect(api.saveGameRecord).not.toHaveBeenCalled();

    act(() => rerender({ currentGame: game(true, 22), ladderReady: true, ladderLevel: 4 }));
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    expect(api.saveGameRecord).toHaveBeenCalledWith('learner4', expect.objectContaining({ level: 4 }));
  });

  it('fails open rather than costing a played game its record', async () => {
    vi.useFakeTimers();
    try {
      const logger = { info: vi.fn(), warn: vi.fn() };
      const { rerender } = renderHook(
        ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
        { initialProps: { currentGame: game(false, 21), ladderReady: false, ladderLevel: null, logger } },
      );
      act(() => rerender({ currentGame: game(true, 22), ladderReady: false, ladderLevel: null, logger }));
      expect(api.saveGameRecord).not.toHaveBeenCalled();
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(logger.warn).toHaveBeenCalledWith('ladder-read-slow', expect.objectContaining({ timeoutMs: 5000 }));
      // Filed WITHOUT a rung rather than against a guessed one: `buildGameRecord`
      // treats a null level as "unknown", which the ladder declines to count. A
      // guess here could promote a child off a rung they never played.
      expect(api.saveGameRecord).toHaveBeenCalledWith('learner4', expect.objectContaining({ level: null }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a deferred result on the way out, and does not also file it as abandoned', () => {
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { rerender, unmount } = renderHook(
      ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
      { initialProps: { currentGame: game(false, 21), ladderReady: false, ladderLevel: null, logger } },
    );
    act(() => rerender({ currentGame: game(true, 22), ladderReady: false, ladderLevel: null, logger }));
    expect(api.saveGameRecord).not.toHaveBeenCalled();
    unmount();
    expect(api.saveGameRecord).toHaveBeenCalledOnce();
    // One archive, and it is the completed one — not a second row calling the
    // same match abandoned.
    expect(api.archiveGame).toHaveBeenCalledOnce();
    expect(api.archiveGame).toHaveBeenCalledWith(expect.objectContaining({ ended_by: 'game_over' }));
  });

  it('files a deferred result against the match that deferred it, not the next one', async () => {
    const { rerender } = renderHook(
      ({ currentGame, ...rest }) => useChessPersistenceLifecycle(props(currentGame, rest)),
      { initialProps: { currentGame: game(false, 21), ladderReady: false, ladderLevel: null, rungId: 'learner' } },
    );
    act(() => rerender({ currentGame: game(true, 22), ladderReady: false, ladderLevel: null, rungId: 'learner' }));
    expect(api.saveGameRecord).not.toHaveBeenCalled();
    // "Play again": a fresh board and a new identity arrive together, and the
    // next match's rung is already published. The parked filing is carried out
    // with the facts of the match it belongs to.
    act(() => rerender({
      currentGame: game(false, 0), gameId: 'game-2', ladderReady: true, ladderLevel: 6, rungId: 'climber',
    }));
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    expect(api.saveGameRecord).toHaveBeenCalledWith('learner4', expect.objectContaining({
      level: null, rung: 'learner', moves: 11,
    }));
  });
});
