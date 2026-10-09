import { useCallback, useEffect, useRef, useState } from 'react';
import { chooseMove } from '@shared-gaming/rulesets/chess/opponent.mjs';
import { LADDER_SIZE } from '@shared-gaming/rulesets/chess/ladder.mjs';
import { fallbackCommentary } from '@shared-gaming/rulesets/chess/commentary.mjs';
import { describeGame, legalMoves } from '@shared-gaming/rulesets/chess/engine.mjs';
import { thinkTimeFor, useOpponentReply } from '../game-platform/opponent/opponentPacing.js';
import { useOpponentDialogue } from '../game-platform/opponent/useOpponentDialogue.js';
import { commitMove } from './chessGameState.js';

/**
 * How long a board may sit on the opponent's turn before we stop believing the
 * rail's "Your opponent is thinking."
 *
 * Longer than the two waits it must not pre-empt: the think ceiling (4s) and
 * `OPPONENT_STALL_MS` (15s), which together are the longest an HONEST turn can
 * take. Past that the turn is not slow, it is gone.
 *
 * On 2026-09-18 a reply was computed, logged (`opponent-replied`, san Qxd4) and
 * then lost between `setGame` and the next render. `useOpponentReply`'s effect
 * keys on `[enabled, resetKey]`, and neither changes when a reply is consumed
 * without advancing the board — so the turn was never asked for again. The
 * child pressed the same square for ten minutes against "not_your_turn", tried
 * every setting on the screen, and finally abandoned a game he was winning.
 * Nothing logged an error, and the Retry button is gated on `opponentError`,
 * which that path never sets.
 */
export const OPPONENT_WAKE_MS = 20000;

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
  opponent = null,
  setGame,
  announce,
  logger,
  requestMove,
  requestQuip = null,
  commitAuthorityMove = null,
  recordMoveTiming = null,
  stallWakeMs = OPPONENT_WAKE_MS,
}) {
  const wakeMs = Number.isFinite(stallWakeMs) && stallWakeMs > 0 ? stallWakeMs : OPPONENT_WAKE_MS;
  const requestedFenRef = useRef(null);
  const effectiveOpponentRef = useRef(null);
  if (opponent && effectiveOpponentRef.current?.id !== opponent.id) {
    effectiveOpponentRef.current = { ...opponent };
  }
  const ladderLevelRef = useRef(ladderLevel);
  const [replyNonce, setReplyNonce] = useState(0);
  const [opponentError, setOpponentError] = useState(null);
  const [stalled, setStalled] = useState(false);
  const {
    prepareReaction, commitReaction, showTerminalReaction,
    speech, dialogueRef, reset: resetDialogue,
  } = useOpponentDialogue({ logger });
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
    if (served?.opponent || opponent) effectiveOpponentRef.current = {
      ...(opponent || {}), ...(served?.opponent || {}),
      id: opponent?.id || served?.opponent?.id || null,
      name: opponent?.name || served?.opponent?.name || null,
    };

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
      const move = committed.event.move;
      const fallback = fallbackCommentary({ move, status: committed.state.status, playerColor });
      const opponentId = opponent?.id || served?.opponent?.id || null;
      const event = {
        gameId: 'chess', sessionId: gameId, ply: committed.state.history.length, opponentId,
      };
      const plan = { fen, served, candidate, committed, reaction: null };
      if (requestQuip) {
        plan.reaction = prepareReaction({
          request: () => requestQuip({
            gameId,
            ply: committed.state.history.length,
            level: ladderLevelRef.current,
            playerColor,
            game: committed.state.game,
            dialogue: dialogueRef.current.map(({ ply, quip }) => ({ ply, quip })),
            userId,
          }),
          fallback: { eventId: `${gameId}:${committed.state.history.length}:${move?.san || 'move'}`, quip: fallback },
          event,
        });
      }
      return plan;
    }
    return { fen, unrecoverable: true };
  }, [dialogueRef, gameId, gameRef, localFallbackDifficulty, logger, opponent?.id, opponent?.name, playerColor, prepareReaction, requestMove, requestQuip, rungId, userId]);

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
      if (plan.reaction) commitReaction(plan.reaction);
      recordMoveTiming?.(committedState.history.length);
      setGame(committedState);
      announce(committedState);
      logger.info('opponent-replied', {
        san: move?.san ?? plan.candidate.san ?? null,
        engine: plan.candidate.source === 'server' ? (plan.served?.engine ?? 'server') : plan.candidate.source,
        opponent: plan.served?.opponent || null,
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
  }, [announce, commitAuthorityMove, commitReaction, gameId, gameRef, logger, recordMoveTiming, setGame]);

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
    resetDialogue();
    setReplyNonce(0);
  }, [resetDialogue]);

  const showTerminalSpeech = useCallback((state) => {
    if (!state?.status?.game_over) return;
    const move = state.history?.at(-1);
    if (!move) return;
    const displayed = {
      eventId: `${gameId}:${state.history.length}:${move.san || 'move'}`,
      quip: fallbackCommentary({ move, status: state.status, playerColor }),
      source: 'fallback',
    };
    showTerminalReaction({
      reaction: displayed,
      event: {
        gameId: 'chess', sessionId: gameId, ply: state.history.length,
        opponentId: opponent?.id || effectiveOpponentRef.current?.id || null,
      },
    });
  }, [gameId, opponent?.id, playerColor, showTerminalReaction]);

  const retryOpponent = useCallback(() => setReplyNonce((value) => value + 1), []);

  /**
   * Ask again, out loud. The same nonce bump `retryOpponent` does — a changed
   * `resetKey` re-runs the reply effect and issues a fresh request — but named
   * and logged, because this one is a CHILD deciding the game is stuck.
   */
  const wakeOpponent = useCallback(() => {
    logger.info?.('opponent-woken', { gameId, by: 'player' });
    setStalled(false);
    setReplyNonce((value) => value + 1);
  }, [gameId, logger]);

  /**
   * THE BOARD'S OWN WATCHDOG, not the request's.
   *
   * `useOpponentReply` already guards a request that never settles. This guards
   * the case that guard cannot see: a request that settled, was committed, and
   * still left the board on the opponent's turn. It re-arms once on its own —
   * most stalls end there, before a child notices — and then says so, which is
   * what puts the wake control on screen.
   *
   * Keyed on the ply the opponent owes, so a turn that lands clears it and the
   * next turn gets its own full budget.
   */
  const owedPly = enabled ? game.history.length : null;
  useEffect(() => {
    setStalled(false);
    if (owedPly === null) return undefined;
    const timer = globalThis.setTimeout(() => {
      logger.warn?.('opponent-board-stalled', { gameId, ply: owedPly, afterMs: wakeMs });
      setStalled(true);
      setReplyNonce((value) => value + 1);
    }, wakeMs);
    return () => globalThis.clearTimeout(timer);
  }, [owedPly, gameId, logger, wakeMs]);

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
    /** The opponent owes a move right now — whether or not it is late. */
    opponentOwesMove: enabled,
    /** It is late, the board has already re-asked once, and nobody answered. */
    opponentStalled: stalled,
    wakeOpponent,
  };
}

export default useChessOpponentTurn;
