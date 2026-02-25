import { useEffect, useRef } from 'react';

/**
 * Shared hook for fullscreen game lifecycle:
 * 1. Auto-starts the game on mount when phase is IDLE.
 * 2. Auto-deactivates when phase returns to IDLE after a terminal phase.
 *
 * @param {string} phase - Current game phase (e.g. 'IDLE', 'PLAYING', 'GAME_OVER', 'COMPLETE')
 * @param {function} startGame - Callback to start the game
 * @param {function} onDeactivate - Callback to exit the game
 * @param {Object} logger - Structured logger instance
 * @param {string} gameName - Game name for log events (e.g. 'tetris', 'flashcards')
 */
export function useAutoGameLifecycle(phase, startGame, onDeactivate, logger, gameName) {
  const prevPhaseRef = useRef(phase);

  // Auto-start on mount when IDLE
  useEffect(() => {
    if (phase === 'IDLE') {
      logger.info(`${gameName}.auto-start`, {});
      startGame();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional mount-only

  // Auto-deactivate when phase transitions back to IDLE from non-IDLE
  useEffect(() => {
    if (prevPhaseRef.current !== 'IDLE' && phase === 'IDLE') {
      logger.info(`${gameName}.auto-deactivate`, {});
      onDeactivate?.();
    }
    prevPhaseRef.current = phase;
  }, [phase, onDeactivate, logger, gameName]);
}
