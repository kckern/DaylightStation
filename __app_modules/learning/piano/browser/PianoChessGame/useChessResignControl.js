import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * THE WAY OUT OF A GAME IN PROGRESS: ask, then do.
 *
 * On 2026-11-11 a child reached a king-bishop-knight ending he could not win,
 * on a board that froze for a minute after every move, and nothing on the
 * screen or under his hands could end it. Leaving kept it resumable, so the
 * same game came back on the next launch. This is the exit, from both inputs:
 *
 *   - touch: the rail's "New game" opens the sheet; the sheet's buttons decide.
 *   - keys:  six adjacent keys (`'newgame'`, chordGestures.js) opens it; six
 *            again confirms; an octave — the board's "put it back" — keeps
 *            playing (wired through `cancel` by the input controller).
 *
 * Always a confirm step, because a stray six-key smear or a brushed button
 * must never throw away a game. `gesture` is the SETTLED gesture, so the same
 * held cluster cannot both open and confirm: the keys have to come up between.
 */
export function useChessResignControl({ gesture, enabled, onConfirm, logger, gameId }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const lastGestureRef = useRef(gesture);

  const show = useCallback((source) => {
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    logger.info('chess.resign.asked', { gameId, source });
  }, [gameId, logger]);

  const cancel = useCallback((source) => {
    if (!openRef.current) return false;
    openRef.current = false;
    setOpen(false);
    logger.info('chess.resign.cancelled', { gameId, source });
    return true;
  }, [gameId, logger]);

  const confirm = useCallback((source) => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    onConfirm(source);
  }, [onConfirm]);

  useEffect(() => {
    const previous = lastGestureRef.current;
    lastGestureRef.current = gesture;
    if (gesture !== 'newgame' || previous === 'newgame' || !enabled) return;
    if (openRef.current) confirm('keys');
    else show('keys');
  }, [confirm, enabled, gesture, show]);

  // A game that ends (or is replaced) under the sheet takes the question with it.
  useEffect(() => {
    if (!enabled && openRef.current) {
      openRef.current = false;
      setOpen(false);
    }
  }, [enabled]);
  useEffect(() => {
    openRef.current = false;
    setOpen(false);
  }, [gameId]);

  return { open, openRef, show, cancel, confirm };
}

export default useChessResignControl;
