import { useEffect, useRef, useState } from 'react';

/**
 * Cosmetic speech driven by committed plies. Newest position wins; no queue,
 * no retry, and no result from an old game may speak over the current one.
 */
export function useChessOpponentSpeech({
  gameId,
  game,
  level,
  playerColor,
  userId,
  fallback = null,
  requestQuip,
  logger,
}) {
  const [speech, setSpeech] = useState(null);
  const observedRef = useRef({ gameId, ply: game.history.length });
  const requestRef = useRef(0);

  useEffect(() => () => { requestRef.current += 1; }, []);

  useEffect(() => {
    const ply = game.history.length;
    const observed = observedRef.current;
    if (observed.gameId !== gameId) {
      observedRef.current = { gameId, ply };
      requestRef.current += 1;
      setSpeech(null);
      return;
    }
    if (ply <= observed.ply) {
      // A takeback invalidates speech about the removed future, but does not
      // itself create a fake move reaction. The next newly committed ply does.
      if (ply < observed.ply) {
        observedRef.current = { gameId, ply };
        requestRef.current += 1;
        setSpeech(null);
      }
      return;
    }

    observedRef.current = { gameId, ply };
    const requestId = ++requestRef.current;
    const last = game.history.at(-1);
    const localQuip = fallback || (last?.color === playerColor
      ? 'I see what you are building.'
      : 'Your turn to answer that.');
    const fallbackSpeech = {
      eventId: `${gameId}:${ply}:${last?.san || 'move'}`,
      quip: localQuip,
      source: 'local',
    };
    setSpeech(fallbackSpeech);

    Promise.resolve(requestQuip({
      gameId,
      ply,
      level,
      playerColor,
      game: game.game,
      userId,
    })).then((reaction) => {
      if (requestId !== requestRef.current || !reaction?.quip) return;
      setSpeech(reaction);
    }).catch((error) => {
      logger?.warn?.('chess.speech.request-error', { gameId, ply, error: error.message });
    });
  }, [fallback, game.game, game.history, gameId, level, logger, playerColor, requestQuip, userId]);

  return speech;
}

export default useChessOpponentSpeech;
