import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pacing = vi.hoisted(() => ({
  thinkTimeFor: vi.fn(() => 900),
  useOpponentReply: vi.fn(() => ({ thinking: true })),
}));
const requestOpponentMove = vi.hoisted(() => vi.fn(async () => null));

vi.mock('../game-platform/opponent/opponentPacing.js', () => pacing);
import { useChessOpponentTurn } from './useChessOpponentTurn.js';
import { commitMove, createChessGameState } from './chessGameState.js';

function opponentState() {
  const initial = createChessGameState({ playerColor: 'w', shuffleEachTurn: false });
  return commitMove(initial, 'e2', 'e4').state;
}

function hookProps(game, overrides = {}) {
  return {
    game,
    gameRef: { current: game },
    gameId: 'game-1',
    playerColor: 'w',
    ladderReady: true,
    ladderLevel: 4,
    chessConfig: { opponent: { pace: 1.25 } },
    gameSeed: 7,
    fallbackThinkMs: 1200,
    rungId: 'learner',
    userId: 'felix',
    localFallbackDifficulty: 'learner',
    setGame: vi.fn(),
    announce: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    requestMove: requestOpponentMove,
    ...overrides,
  };
}

describe('useChessOpponentTurn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owns opponent pacing and sends the current position with ladder authority', async () => {
    const game = {
      game: { fen: 'current-fen' },
      history: [{ san: 'e4' }],
      status: { game_over: false, turn: 'b' },
    };
    const gameRef = { current: game };
    const { result } = renderHook(() => useChessOpponentTurn({
      game,
      gameRef,
      gameId: 'game-1',
      playerColor: 'w',
      ladderReady: true,
      ladderLevel: 4,
      chessConfig: { opponent: { pace: 1.25 } },
      gameSeed: 7,
      fallbackThinkMs: 1200,
      rungId: 'learner',
      userId: 'felix',
      localFallbackDifficulty: 'learner',
      setGame: vi.fn(),
      announce: vi.fn(),
      logger: { info: vi.fn() },
      requestMove: requestOpponentMove,
    }));

    expect(result.current.thinking).toBe(true);
    expect(result.current.thinkMs).toBe(900);
    expect(pacing.thinkTimeFor).toHaveBeenCalledWith(expect.objectContaining({ level: 4, pace: 1.25 }));

    const replyContract = pacing.useOpponentReply.mock.calls[0][0];
    expect(replyContract).toMatchObject({ enabled: true, thinkMs: 900, resetKey: 'game-1:0' });
    await replyContract.request();
    expect(requestOpponentMove).toHaveBeenCalledWith({
      fen: 'current-fen', rung: 'learner', level: 4, gameId: 'game-1', userId: 'felix',
    });
  });

  it('commits and announces a legal served reply', async () => {
    const game = opponentState();
    const props = hookProps(game);
    renderHook(() => useChessOpponentTurn(props));
    const contract = pacing.useOpponentReply.mock.calls[0][0];
    await contract.request();
    contract.onReply({ from: 'e7', to: 'e5', san: 'e5', engine: 'stockfish' });

    expect(props.setGame).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.arrayContaining([expect.objectContaining({ san: 'e5', color: 'b' })]),
      rejection: null,
    }));
    expect(props.announce).toHaveBeenCalledOnce();
  });

  it('rejects an illegal server move and commits a legal local fallback', async () => {
    const game = opponentState();
    const props = hookProps(game);
    renderHook(() => useChessOpponentTurn(props));
    const contract = pacing.useOpponentReply.mock.calls[0][0];
    await contract.request();
    contract.onReply({ from: 'a1', to: 'a8', engine: 'broken-server' });

    expect(props.logger.warn).toHaveBeenCalledWith(
      'opponent-reply-invalid', expect.objectContaining({ source: 'server' }),
    );
    expect(props.setGame).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.arrayContaining([expect.objectContaining({ color: 'b' })]),
      rejection: null,
    }));
    expect(props.announce).toHaveBeenCalledOnce();
  });

  it('drops a reply when the live position no longer matches the requested FEN', async () => {
    const game = opponentState();
    const gameRef = { current: game };
    const props = hookProps(game, { gameRef });
    renderHook(() => useChessOpponentTurn(props));
    const contract = pacing.useOpponentReply.mock.calls[0][0];
    await contract.request();
    gameRef.current = createChessGameState({ playerColor: 'w' });
    contract.onReply({ from: 'e7', to: 'e5' });

    expect(props.setGame).not.toHaveBeenCalled();
    expect(props.announce).not.toHaveBeenCalled();
    expect(props.logger.warn).toHaveBeenCalledWith(
      'opponent-reply-stale', expect.objectContaining({ gameId: 'game-1' }),
    );
  });
});
