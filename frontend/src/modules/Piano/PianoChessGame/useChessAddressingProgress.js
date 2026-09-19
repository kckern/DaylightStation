import { useEffect, useRef } from 'react';
import { useAddressingLadder } from '../game-platform/addressing/useAddressingLadder.js';

/** Record the separate skill of addressing a chess square from the piano. */
export function useChessAddressingProgress({ game, gameId, playerColor, userId, config, client, logger }) {
  const { startTurn, record } = useAddressingLadder({
    client,
    gameId: 'chess',
    userId,
    config,
    logger,
  });
  const historyCursorRef = useRef({ gameId, length: game.history.length, playerTurn: false });
  const rejectionCursorRef = useRef({ gameId, seq: game.rejection?.seq ?? null });
  const isPlayerTurn = !game.status?.game_over && game.status?.turn === playerColor;

  useEffect(() => {
    const cursor = historyCursorRef.current;
    if (cursor.gameId !== gameId || game.history.length < cursor.length) {
      // A SHORTER HISTORY IN THE SAME GAME IS NEWS. A new game legitimately
      // resets the cursor, but a board that goes 7 -> 8 -> 7 has thrown a move
      // away, and this branch used to swallow that in silence — which is why
      // the 2026-09-18 stall left no trace at all: `chess.move` is the only
      // record of a ply landing, and a ply that lands and is then rewound logs
      // nothing on the way in OR on the way out. A takeback rewinds too, and
      // says so through its own event; anything else reaching here is a bug
      // that should never have to be reconstructed by hand again.
      if (cursor.gameId === gameId && game.history.length < cursor.length) {
        logger.warn('chess.history-rewound', {
          from: cursor.length, to: game.history.length, gameId,
        });
      }
      historyCursorRef.current = { gameId, length: game.history.length, playerTurn: isPlayerTurn };
      if (isPlayerTurn) startTurn();
      return;
    }
    const added = game.history.slice(cursor.length);
    historyCursorRef.current = { gameId, length: game.history.length, playerTurn: isPlayerTurn };
    added.forEach((move, index) => {
      const ply = cursor.length + index + 1;
      if (move?.color === playerColor) record({ ok: true });
      logger.info('chess.move', {
        from: move?.from ?? null,
        to: move?.to ?? null,
        san: move?.san ?? null,
        color: move?.color ?? null,
        ply,
        turn: game.turn ?? null,
      });
    });
    const opponentFinishedBatch = added.at(-1)?.color && added.at(-1).color !== playerColor;
    if (isPlayerTurn && (!cursor.playerTurn || opponentFinishedBatch)) startTurn();
  }, [game.history, game.turn, gameId, isPlayerTurn, logger, playerColor, record, startTurn]);

  useEffect(() => {
    if (game.rejection?.seq === undefined) return;
    const cursor = rejectionCursorRef.current;
    if (cursor.gameId === gameId && cursor.seq === game.rejection.seq) return;
    rejectionCursorRef.current = { gameId, seq: game.rejection.seq };
    record({ ok: false });
    logger.info('chess.rejected', {
      reason: game.rejection.reason ?? null,
      square: game.rejection.square ?? null,
      ply: game.history.length,
    });
  }, [game.history.length, game.rejection, gameId, logger, record]);
}

export default useChessAddressingProgress;
