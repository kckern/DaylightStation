import { useCallback, useEffect, useRef, useState } from 'react';
import { fenBefore, isPlayerTurn } from './chessGameState.js';

/** Own hint, analysis, replay, and opening-stage state for one chess session. */
export function useChessHelpController({
  game,
  gameRef,
  gameId,
  userId,
  gesture,
  requestBestMove,
  logger,
  openingMs,
  replayHoldMs,
  replayMoveMs,
}) {
  const [opening, setOpening] = useState(true);
  const [replay, setReplay] = useState(null);
  const [help, setHelp] = useState({ legal: false, best: null });
  const [helpUsed, setHelpUsed] = useState({ hints: 0, bestMoves: 0, takebacks: 0 });
  const helpUsedRef = useRef(helpUsed);
  helpUsedRef.current = helpUsed;
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;
  const requestTokenRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!replay) return undefined;
    if (replay.phase === 'rewind') {
      const timer = setTimeout(() => setReplay((value) => (
        value ? { ...value, phase: 'play' } : null
      )), replayHoldMs);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setReplay(null), replayMoveMs + 120);
    return () => clearTimeout(timer);
  }, [replay, replayHoldMs, replayMoveMs]);

  useEffect(() => { setReplay(null); }, [game.history.length]);

  useEffect(() => {
    if (!opening) return undefined;
    const timer = setTimeout(() => setOpening(false), openingMs);
    return () => clearTimeout(timer);
  }, [opening, openingMs]);

  useEffect(() => {
    if (opening && game.history.length) setOpening(false);
  }, [game.history.length, opening]);

  useEffect(() => {
    if (gesture === 'hint' && !help.legal) {
      if (!isPlayerTurn(gameRef.current)) {
        logger.info('help-ignored', { kind: 'legal', reason: 'not_player_turn' });
      } else {
        setHelp((value) => ({ ...value, legal: true }));
        setHelpUsed((value) => ({ ...value, hints: value.hints + 1 }));
        logger.info('help-requested', { kind: 'legal' });
      }
    }

    if (gesture === 'replay' && !replay) {
      const live = gameRef.current;
      const plies = Math.min(2, live.history.length);
      const from = plies ? fenBefore(live, plies) : null;
      if (from) {
        setReplay({ fen: from, phase: 'rewind' });
        logger.info('replay-requested', { plies });
      }
    }

    if (gesture === 'best' && !help.best && !requestTokenRef.current) {
      const askedFen = gameRef.current.game.fen;
      const askedGameId = gameIdRef.current;
      const token = Symbol('best-move');
      requestTokenRef.current = token;
      logger.info('help-requested', { kind: 'best' });
      Promise.resolve(requestBestMove({ fen: askedFen, userId })).then((move) => {
        if (requestTokenRef.current !== token) return;
        requestTokenRef.current = null;
        if (!mountedRef.current || !move) return;
        const live = gameRef.current;
        const stillValid = gameIdRef.current === askedGameId
          && live.game.fen === askedFen
          && isPlayerTurn(live);
        if (!stillValid) {
          logger.info('help-answer-stale', {
            kind: 'best',
            asked_fen: askedFen,
            live_fen: live.game.fen,
            same_game: gameIdRef.current === askedGameId,
            player_turn: isPlayerTurn(live),
          });
          return;
        }
        setHelp((value) => ({ ...value, best: { from: move.from, to: move.to } }));
        setHelpUsed((value) => ({ ...value, bestMoves: value.bestMoves + 1 }));
      }).catch((error) => {
        if (requestTokenRef.current === token) requestTokenRef.current = null;
        logger.warn?.('help-request-failed', { kind: 'best', error: error?.message });
      });
    }
    // Gesture transitions trigger this controller; live game facts are read
    // through refs so unrelated renders never repeat a help request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture]);

  useEffect(() => {
    if (game.history.length === 0) return;
    setHelp({ legal: false, best: null });
  }, [game.history.length]);

  const addTakeback = useCallback(() => {
    setHelpUsed((value) => ({ ...value, takebacks: value.takebacks + 1 }));
  }, []);

  const resetHelp = useCallback(() => {
    requestTokenRef.current = null;
    setOpening(true);
    setReplay(null);
    setHelp({ legal: false, best: null });
    setHelpUsed({ hints: 0, bestMoves: 0, takebacks: 0 });
  }, []);

  return {
    opening,
    replay,
    help,
    helpUsed,
    helpUsedRef,
    addTakeback,
    resetHelp,
  };
}

export default useChessHelpController;
