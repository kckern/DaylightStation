import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startTurn, record } = vi.hoisted(() => ({ startTurn: vi.fn(), record: vi.fn() }));

vi.mock('../game-platform/addressing/useAddressingLadder.js', () => ({
  useAddressingLadder: () => ({ startTurn, record }),
}));

import { useChessAddressingProgress } from './useChessAddressingProgress.js';

const logger = { info: vi.fn() };
const baseGame = {
  history: [],
  rejection: null,
  status: { game_over: false, turn: 'w' },
  turn: 'w',
};

describe('useChessAddressingProgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts the player clock and records landed and refused addresses', () => {
    const { rerender } = renderHook(
      ({ game }) => useChessAddressingProgress({
        game,
        gameId: 'game-1',
        playerColor: 'w',
        userId: 'learner4',
        config: {},
        client: {},
        logger,
      }),
      { initialProps: { game: baseGame } },
    );
    expect(startTurn).toHaveBeenCalledOnce();

    rerender({
      game: {
        ...baseGame,
        history: [{ from: 'e2', to: 'e4', san: 'e4', color: 'w' }],
        rejection: { seq: 1, reason: 'illegal_move', square: 'e5' },
      },
    });

    expect(record).toHaveBeenCalledWith({ ok: true });
    expect(record).toHaveBeenCalledWith({ ok: false });
    expect(logger.info).toHaveBeenCalledWith('chess.move', expect.objectContaining({ san: 'e4' }));
    expect(logger.info).toHaveBeenCalledWith('chess.rejected', expect.objectContaining({ square: 'e5' }));
  });

  it('logs every new ply but records only the player\'s addresses', () => {
    const { rerender } = renderHook(
      ({ game, gameId }) => useChessAddressingProgress({
        game,
        gameId,
        playerColor: 'w',
        userId: 'learner4',
        config: {},
        client: {},
        logger,
      }),
      { initialProps: { game: baseGame, gameId: 'game-1' } },
    );

    const playerMove = { from: 'e2', to: 'e4', san: 'e4', color: 'w' };
    const opponentMove = { from: 'e7', to: 'e5', san: 'e5', color: 'b' };
    rerender({
      gameId: 'game-1',
      game: { ...baseGame, history: [playerMove, opponentMove], status: { game_over: false, turn: 'w' } },
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({ ok: true });
    expect(logger.info).toHaveBeenCalledWith('chess.move', expect.objectContaining({ san: 'e4', color: 'w', ply: 1 }));
    expect(logger.info).toHaveBeenCalledWith('chess.move', expect.objectContaining({ san: 'e5', color: 'b', ply: 2 }));
    expect(startTurn).toHaveBeenCalledTimes(2);
  });

  it('does not replay history or a rejection when callbacks change or a new session mounts', () => {
    const played = {
      ...baseGame,
      history: [{ from: 'e2', to: 'e4', san: 'e4', color: 'w' }],
      rejection: { seq: 7, reason: 'illegal_move', square: 'e5' },
    };
    const { rerender } = renderHook(
      ({ game, gameId, logger: currentLogger }) => useChessAddressingProgress({
        game,
        gameId,
        playerColor: 'w',
        userId: 'learner4',
        config: {},
        client: {},
        logger: currentLogger,
      }),
      { initialProps: { game: played, gameId: 'game-1', logger } },
    );
    expect(record).not.toHaveBeenCalled();

    rerender({ game: played, gameId: 'game-1', logger: { info: vi.fn() } });
    expect(record).not.toHaveBeenCalled();

    rerender({ game: { ...baseGame, history: [] }, gameId: 'game-2', logger });
    expect(record).not.toHaveBeenCalled();
  });
  it('a resumed game landing on the board is a restore, not a hundred fresh addresses', () => {
    // chess-1794439407456, 2026-11-11: the board mounted empty, the resumed
    // 199-ply game arrived in one render, and every one of the player's ~100
    // historical moves was recorded as a fresh, instant, correct address. The
    // ladder promoted five rungs in 40 ms (8 -> 13, `addressing.rung-changed`
    // x5), re-dealt the board mid-game, and the child's next chords no longer
    // named anything (`chess.rejected unrecognised_chord` x6).
    const restored = Array.from({ length: 199 }, (_, index) => ({
      from: 'a1', to: 'a2', san: `m${index + 1}`, color: index % 2 === 0 ? 'w' : 'b',
    }));
    const { rerender } = renderHook(
      ({ game }) => useChessAddressingProgress({
        game, gameId: 'game-1', playerColor: 'w', userId: 'learner4', config: {}, client: {}, logger,
      }),
      { initialProps: { game: baseGame } },
    );
    record.mockClear();
    logger.info.mockClear();

    rerender({ game: { ...baseGame, history: restored, status: { game_over: false, turn: 'b' }, turn: 'b' } });

    expect(record).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith('chess.move', expect.anything());
    expect(logger.info).toHaveBeenCalledWith('chess.history-restored', expect.objectContaining({ from: 0, to: 199, gameId: 'game-1' }));

    // ...and the game carries on normally from there.
    rerender({
      game: {
        ...baseGame,
        history: [...restored, { from: 'b1', to: 'a1', san: 'Ka1', color: 'b' }, { from: 'c5', to: 'd4', san: 'Bd4+', color: 'w' }],
        status: { game_over: false, turn: 'b' },
        turn: 'b',
      },
    });
    expect(record).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('chess.move', expect.objectContaining({ san: 'Bd4+', ply: 201 }));
  });
});
