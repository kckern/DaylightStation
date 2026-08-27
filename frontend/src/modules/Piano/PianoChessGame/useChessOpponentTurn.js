import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseMove } from '@shared-gaming/rulesets/chess/opponent.mjs';
import { LADDER_SIZE } from '@shared-gaming/rulesets/chess/ladder.mjs';
import { fallbackCommentary } from '@shared-gaming/rulesets/chess/commentary.mjs';
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
  requestQuip = null,
  commitAuthorityMove = null,
  recordMoveTiming = null,
}) {
  const requestedFenRef = useRef(null);
  const effectiveOpponentRef = useRef(null);
  const ladderLevelRef = useRef(ladderLevel);
  const [replyNonce, setReplyNonce] = useState(0);
  const [opponentError, setOpponentError] = useState(null);
  const [speech, setSpeech] = useState(null);
  const dialogueRef = useRef([]);
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

  useEffect(() => {
    if (enabled) setSpeech(null);
  }, [enabled, gameId]);

  const request = useCallback(async () => {
    setOpponentError(null);
    requestedFenRef.current = gameRef.current.game.fen;
    const served = await requestMove({
      fen: requestedFenRef.current,
      rung: rungId,
      level: ladderLevelRef.current,
      gameId,
      userId,
    });
    const fen = requestedFenRef.current;
    const current = gameRef.current;
    if (!fen || current.game.fen !== fen) return { stale: true, fen };
    if (served?.opponent) effectiveOpponentRef.current = served.opponent;

    const local = chooseMove(fen, { difficulty: localFallbackDifficulty, seed: current.history.length });
    const deterministic = legalMoves(fen)[0] ?? null;
    const candidates = [
      served?.from && served?.to ? { ...served, source: 'server' } : null,
      local?.from && local?.to ? { ...local, source: 'local' } : null,
      deterministic?.from && deterministic?.to ? { ...deterministic, source: 'deterministic' } : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const committed = commitMove(current, candidate.from, candidate.to, candidate.promotion, Date.now());
      if (committed.event.type === 'rejected') {
        logger.warn?.('opponent-reply-invalid', {
          source: candidate.source, from: candidate.from, to: candidate.to,
          reason: committed.event.reason, gameId,
        });
        continue;
      }
      const plan = { fen, served, candidate, committed, reaction: null, reactionOutcome: null, reactionSettled: false };
      if (requestQuip) {
        const dialogue = dialogueRef.current.map(({ ply, quip }) => ({ ply, quip }));
        plan.reactionPromise = Promise.resolve(requestQuip({
          gameId,
          ply: committed.state.history.length,
          level: ladderLevelRef.current,
          playerColor,
          game: committed.state.game,
          dialogue,
          userId,
        })).then((reaction) => {
          plan.reactionOutcome = reaction || null;
          plan.reaction = reaction?.quip ? reaction : null;
          plan.reactionSettled = true;
          return plan.reaction;
        }).catch((error) => {
          plan.reactionSettled = true;
          logger.warn?.('chess.dialogue.request-error', { gameId, error: error.message });
          return null;
        });
      }
      logger.info?.('chess.dialogue.planned', { gameId, ply: committed.state.history.length, thinkMs: scheduledThinkMs });
      return plan;
    }
    return { fen, unrecoverable: true };
  }, [gameId, gameRef, localFallbackDifficulty, logger, playerColor, requestMove, requestQuip, rungId, scheduledThinkMs, userId]);

  const onReply = useCallback(async (plan) => {
    const fen = plan?.fen || requestedFenRef.current;
    const current = gameRef.current;
    if (!plan || plan.stale || !fen || current.game.fen !== fen) {
      logger.warn?.('opponent-reply-stale', { requestedFen: fen, liveFen: current.game.fen, gameId });
      return;
    }
    if (!plan.unrecoverable && plan.committed) {
      let committedState = plan.committed.state;
      if (commitAuthorityMove) committedState = await commitAuthorityMove(plan.candidate);
      setOpponentError(null);
      const move = plan.committed.event.move;
      const fallback = fallbackCommentary({ move, status: committedState.status, playerColor });
      const displayed = plan.reaction || {
        eventId: `${gameId}:${committedState.history.length}:${move?.san || 'move'}`,
        quip: fallback,
        source: 'fallback',
        // The player-visible deadline is the opponent's think window. A reply
        // still pending when that window closes is a timeout for this turn,
        // even if the transport eventually returns and is logged as late.
        fallbackReason: plan.reactionOutcome?.fallbackReason || 'timeout',
      };
      if (!plan.reaction && plan.reactionPromise) {
        plan.reactionPromise.then((late) => {
          if (late?.quip) logger.info?.('chess.dialogue.late-discarded', { gameId, ply: committedState.history.length });
        });
      }
      const entry = {
        ply: committedState.history.length,
        eventId: displayed.eventId,
        quip: displayed.quip,
        source: displayed.source || 'fallback',
        fallbackReason: displayed.fallbackReason || displayed.fallback_reason || null,
        shownAt: new Date().toISOString(),
      };
      dialogueRef.current = [...dialogueRef.current, entry];
      recordMoveTiming?.(entry.ply);
      setSpeech(displayed);
      setGame(committedState);
      announce(committedState);
      logger.info('opponent-replied', {
        san: move?.san ?? plan.candidate.san ?? null,
        engine: plan.candidate.source === 'server' ? (plan.served?.engine ?? 'server') : plan.candidate.source,
        opponent: plan.served?.opponent || null,
      });
      // This is the audit event for what reached the screen. Planned and
      // generated events are diagnostic only; this exact payload is the one a
      // post-game transcript must use.
      logger.info?.('chess.dialogue.displayed', {
        gameId,
        ply: committedState.history.length,
        eventId: displayed.eventId,
        quip: entry.quip,
        source: entry.source,
        fallbackReason: entry.fallbackReason,
        userId,
        opponent: plan.served?.opponent?.name || effectiveOpponentRef.current?.name || null,
        level: ladderLevelRef.current,
        rosterPack: chessConfig?.ladder?.roster_pack || null,
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
  }, [announce, chessConfig?.ladder?.roster_pack, commitAuthorityMove, gameId, gameRef, logger, playerColor, recordMoveTiming, setGame, userId]);

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
    setSpeech(null);
    dialogueRef.current = [];
    setReplyNonce(0);
  }, []);

  const showTerminalSpeech = useCallback((state) => {
    if (!state?.status?.game_over) return;
    const move = state.history?.at(-1);
    if (!move) return;
    const displayed = {
      eventId: `${gameId}:${state.history.length}:${move.san || 'move'}`,
      quip: fallbackCommentary({ move, status: state.status, playerColor }),
      source: 'fallback',
    };
    const entry = {
      ply: state.history.length,
      eventId: displayed.eventId,
      quip: displayed.quip,
      source: displayed.source,
      fallbackReason: 'terminal',
      shownAt: new Date().toISOString(),
    };
    dialogueRef.current = [...dialogueRef.current, entry];
    setSpeech(displayed);
    logger.info?.('chess.dialogue.displayed', {
      gameId,
      ply: state.history.length,
      eventId: displayed.eventId,
      quip: entry.quip,
      source: entry.source,
      fallbackReason: entry.fallbackReason,
    });
  }, [gameId, logger, playerColor]);

  const retryOpponent = useCallback(() => setReplyNonce((value) => value + 1), []);

  return {
    thinking,
    thinkMs: enabled ? scheduledThinkMs : null,
    speech,
    dialogueRef,
    showTerminalSpeech,
    effectiveOpponentRef,
    opponentError,
    retryOpponent,
    resetOpponent,
  };
}

export default useChessOpponentTurn;
