import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  archiveGame: vi.fn(),
  beaconArchive: vi.fn(() => true),
  saveGameRecord: vi.fn(async () => ({ ladder: { promoted: true } })),
}));

import { useChessPersistenceLifecycle } from './useChessPersistenceLifecycle.js';

const move = { at: 20, san: 'e4', from: 'e2', to: 'e4', color: 'w', chords: ['Em', 'Eadd9'] };
const game = (gameOver = false) => ({
  game: { fen: 'final-fen' },
  initialFen: 'initial-fen',
  history: [move],
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
  addressing: 'chords',
  opponentRef: { current: { id: 'practice-opponent' } },
  helpUsed: { hints: 1, bestMoves: 0, takebacks: 0 },
  timing: { mode: 'off' },
  playerColor: 'w',
  logger: { info: vi.fn(), warn: vi.fn() },
  gateway: api,
  ...overrides,
});

describe('useChessPersistenceLifecycle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists and archives one completed game from one set of facts', async () => {
    const { result } = renderHook(() => useChessPersistenceLifecycle(props(game(true))));
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    expect(api.archiveGame).toHaveBeenCalledOnce();
    expect(result.current.finishedRecord).toMatchObject({ result: 'win', level: 2 });
    expect(result.current.ladderOutcome).toEqual({ promoted: true });
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
    const { result, rerender } = renderHook(
      ({ currentGame, gameId }) => useChessPersistenceLifecycle(props(currentGame, { gameId })),
      { initialProps: { currentGame: game(true), gameId: 'game-1' } },
    );
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());

    rerender({ currentGame: game(false), gameId: 'game-2' });
    await act(async () => resolveFirst({ ladder: { promoted: true } }));
    expect(result.current.ladderOutcome).toBe(null);
    expect(result.current.finishedRecord).toBe(null);
  });

  it('does not update state from a save that resolves after unmount', async () => {
    let resolveSave;
    api.saveGameRecord.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    const { unmount } = renderHook(() => useChessPersistenceLifecycle(props(game(true))));
    await waitFor(() => expect(api.saveGameRecord).toHaveBeenCalledOnce());
    unmount();
    await act(async () => resolveSave({ ladder: { promoted: true } }));
  });

  it('archives a guest completion without writing a per-user record', () => {
    renderHook(() => useChessPersistenceLifecycle(props(game(true), { userId: null })));
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
