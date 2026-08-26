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
});
