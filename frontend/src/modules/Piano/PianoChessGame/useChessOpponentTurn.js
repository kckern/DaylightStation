import { useCallback, useRef, useState } from 'react';
import { chooseMove } from '@shared-gaming/rulesets/chess/opponent.mjs';
import { LADDER_SIZE } from '@shared-gaming/rulesets/chess/ladder.mjs';
import { describeGame, legalMoves } from '@shared-gaming/rulesets/chess/engine.mjs';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import { commitMove } from './chessGameState.js';

/** Request, pace, validate, and commit the opponent's turn. */
export function useChessOpponentTurn({
  game,
  gameRef,
  gameId,
  playerColor,
  ladderReady,
  ladderLevel,
  chessConfig,
  gameSeed,
  fallbackThinkMs,
  rungId,
  userId,
  localFallbackDifficulty,
  setGame,
  announce,
  logger,
  requestMove,
  commitAuthorityMove = null,
}) {
  const requestedFenRef = useRef(null);
  const effectiveOpponentRef = useRef(null);
  const ladderLevelRef = useRef(ladderLevel);
  const [replyNonce, setReplyNonce] = useState(0);
  const [opponentError, setOpponentError] = useState(null);
  ladderLevelRef.current = ladderLevel;

  const enabled = ladderReady && !game.status?.game_over && game.status?.turn !== playerColor;
  const scheduledThinkMs = thinkTimeFor({
    level: ladderLevel,
    levels: LADDER_SIZE,
    config: chessConfig,
    seed: gameSeed,
    ply: game.history.length,
    pace: chessConfig?.opponent?.pace ?? 1,
  }) ?? fallbackThinkMs;

  const request = useCallback(() => {
    setOpponentError(null);
    requestedFenRef.current = gameRef.current.game.fen;
    return requestMove({
      fen: requestedFenRef.current,
      rung: rungId,
      level: ladderLevelRef.current,
      gameId,
      userId,
    });
  }, [gameId, gameRef, requestMove, rungId, userId]);

  const onReply = useCallback(async (served) => {
    const fen = requestedFenRef.current;
    const current = gameRef.current;
    if (!fen || current.game.fen !== fen) {
      logger.warn?.('opponent-reply-stale', { requestedFen: fen, liveFen: current.game.fen, gameId });
      return;
    }
    if (served?.opponent) effectiveOpponentRef.current = served.opponent;

    const local = chooseMove(fen, {
      difficulty: localFallbackDifficulty,
      seed: current.history.length,
    });
    const deterministic = legalMoves(fen)[0] ?? null;
    const candidates = [
      served?.from && served?.to ? { ...served, source: 'server' } : null,
      local?.from && local?.to ? { ...local, source: 'local' } : null,
      deterministic?.from && deterministic?.to ? { ...deterministic, source: 'deterministic' } : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const committed = commitMove(
        current, candidate.from, candidate.to, candidate.promotion, Date.now(),
      );
      if (committed.event.type === 'rejected') {
        logger.warn?.('opponent-reply-invalid', {
          source: candidate.source,
          from: candidate.from,
          to: candidate.to,
          reason: committed.event.reason,
          gameId,
        });
        continue;
      }
      let committedState = committed.state;
      if (commitAuthorityMove) committedState = await commitAuthorityMove(candidate);
      setOpponentError(null);
      setGame(committedState);
      announce(committedState);
      logger.info('opponent-replied', {
        san: committed.event.move?.san ?? candidate.san ?? null,
        engine: candidate.source === 'server' ? (served.engine ?? 'server') : candidate.source,
        opponent: served?.opponent || null,
      });
      return;
    }

    const status = describeGame(current.game);
    if (status?.game_over) {
      setGame({ ...current, status });
      return;
    }
    setOpponentError('Opponent could not make a legal move.');
    logger.error?.('opponent-reply-unrecoverable', { gameId, fen });
  }, [announce, commitAuthorityMove, gameId, gameRef, localFallbackDifficulty, logger, setGame]);

  const { thinking } = useOpponentReply({
    enabled,
    thinkMs: scheduledThinkMs,
    resetKey: `${gameId}:${replyNonce}`,
    request,
    onReply,
  });

  const resetOpponent = useCallback(() => {
    requestedFenRef.current = null;
    effectiveOpponentRef.current = null;
    setOpponentError(null);
    setReplyNonce(0);
  }, []);

  const retryOpponent = useCallback(() => setReplyNonce((value) => value + 1), []);

  return {
    thinking,
    thinkMs: enabled ? scheduledThinkMs : null,
    effectiveOpponentRef,
    opponentError,
    retryOpponent,
    resetOpponent,
  };
}

export default useChessOpponentTurn;
