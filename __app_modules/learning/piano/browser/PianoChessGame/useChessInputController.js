import { useCallback, useEffect, useRef, useState } from 'react';
import { advanceCursor, createCursorState } from './chordCursor.js';
import { applyEvent, createSelection } from './chordSelection.js';
import { clearSelection, destinationsFor } from './chessGameState.js';
import { recognizeGesture } from './chordGestures.js';

const EMPTY_ARRAY = Object.freeze([]);

/** Translate the timed piano gesture stream into hover, move, and takeback intents. */
export function useChessInputController({
  gameId,
  game,
  gameRef,
  heldNotes,
  liveScheme,
  legalMap,
  setGame,
  onSquare,
  onTakeback,
  onRestart,
  logger,
  doubleWindowMs,
  cursorTickMs,
}) {
  const [cursor, setCursor] = useState(null);
  const [armed, setArmed] = useState(null);
  const [armedAt, setArmedAt] = useState(0);
  const cursorRef = useRef(createCursorState());
  const selectionRef = useRef(createSelection());
  const gestureLatchRef = useRef(false);
  const heldNotesRef = useRef(heldNotes);
  heldNotesRef.current = heldNotes;
  const liveSchemeRef = useRef(liveScheme);
  liveSchemeRef.current = liveScheme;
  const legalMapRef = useRef({ fen: game.game.fen, map: legalMap });
  legalMapRef.current = { fen: game.game.fen, map: legalMap };
  const armedAtRef = useRef(armedAt);
  armedAtRef.current = armedAt;
  const anyNotesHeld = heldNotes.length > 0;

  useEffect(() => {
    cursorRef.current = createCursorState();
    selectionRef.current = createSelection();
    gestureLatchRef.current = false;
    setCursor(null);
    setArmed(null);
    setArmedAt(0);
  }, [gameId]);

  useEffect(() => {
    selectionRef.current = createSelection();
  }, [game.history.length]);

  const cancelSelection = useCallback(() => {
    setGame((current) => (current.origin ? clearSelection(current) : current));
    logger.debug('selection-cancelled');
  }, [logger, setGame]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') cancelSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelSelection]);

  useEffect(() => {
    if (!heldNotesRef.current.length && !cursorRef.current.held.length) return undefined;
    let timer = null;
    let stopped = false;
    const tick = () => {
      const wasGesture = !!recognizeGesture(cursorRef.current.held);
      if (wasGesture) gestureLatchRef.current = true;
      const advanced = advanceCursor(
        cursorRef.current,
        heldNotesRef.current,
        Date.now(),
        { scheme: liveSchemeRef.current },
      );
      cursorRef.current = advanced.state;
      const latched = gestureLatchRef.current;
      if (!advanced.state.held.length) gestureLatchRef.current = false;
      const { event } = advanced;
      if (!event) return;
      if (event.type === 'preview') setCursor(event.square);
      if (event.type === 'escape') {
        setCursor(null);
        const current = gameRef.current;
        const at = Date.now();
        if (current.status?.game_over) {
          onRestart();
        } else if (current.origin) {
          cancelSelection();
          setArmedAt(0);
        } else if (armedAtRef.current && at - armedAtRef.current <= doubleWindowMs) {
          setArmedAt(0);
          onTakeback();
        } else {
          setArmedAt(at);
          logger.debug('takeback-armed', { moves_played: current.history.length });
        }
      }
      if (event.type === 'commit') setCursor(null);
      if (event.type === 'preview' || event.type === 'commit') {
        if (wasGesture || (latched && !event.square)) return;
        const current = gameRef.current;
        const holdingPiece = Boolean(current.origin);
        const cached = legalMapRef.current;
        const reach = holdingPiece
          ? (cached.fen === current.game.fen
            ? (cached.map[current.origin] ?? EMPTY_ARRAY)
            : destinationsFor(current, current.origin))
          : EMPTY_ARRAY;
        const isEligible = holdingPiece && reach.includes(event.square);
        const at = Date.now();
        const previous = selectionRef.current;
        const resolved = applyEvent(previous, {
          type: event.type,
          square: event.square,
          at,
          holdingPiece,
          isEligible,
        });
        selectionRef.current = resolved.selection;
        setArmed((currentArmed) => {
          const next = resolved.selection.lastSquare
            ? { square: resolved.selection.lastSquare, at: resolved.selection.lastAt }
            : null;
          if (!currentArmed && !next) return currentArmed;
          if (currentArmed && next
            && currentArmed.square === next.square && currentArmed.at === next.at) return currentArmed;
          return next;
        });
        if (event.type === 'commit' && !holdingPiece && event.square) {
          const sameSquare = previous.lastSquare === event.square;
          const elapsed = sameSquare ? at - previous.lastAt : null;
          if (resolved.action.type === 'pickup') {
            logger.info('pickup', { square: event.square, sinceFirstMs: elapsed });
          } else if (sameSquare) {
            logger.info('pickup-window-missed', {
              square: event.square,
              sinceFirstMs: elapsed,
              windowMs: doubleWindowMs,
            });
          } else if (previous.lastSquare) {
            logger.debug('pickup-reset', { was: previous.lastSquare, now: event.square });
          }
        }
        if (resolved.action.type === 'hover') setCursor(resolved.action.square);
        if (resolved.action.type === 'pickup' || resolved.action.type === 'drop') {
          setArmedAt(0);
          onSquare(resolved.action.square);
        }
        if (resolved.action.type === 'refuse') onSquare(null);
      }
      if (!heldNotesRef.current.length && !cursorRef.current.held.length) {
        stopped = true;
        if (timer) { clearInterval(timer); timer = null; }
      }
    };
    tick();
    if (!stopped) timer = setInterval(tick, cursorTickMs);
    return () => { if (timer) clearInterval(timer); };
  }, [anyNotesHeld, cancelSelection, cursorTickMs, doubleWindowMs, gameRef, logger, onRestart, onSquare, onTakeback]);

  useEffect(() => {
    if (!armedAt) return undefined;
    const timer = setTimeout(() => setArmedAt(0), doubleWindowMs);
    return () => clearTimeout(timer);
  }, [armedAt, doubleWindowMs]);

  return {
    cursor,
    armed,
    takebackArmed: armedAt > 0,
  };
}

export default useChessInputController;
