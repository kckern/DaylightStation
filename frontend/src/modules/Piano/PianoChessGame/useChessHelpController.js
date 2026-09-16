import { useCallback, useEffect, useRef, useState } from 'react';
import { helpWithinCeilings } from '@shared-gaming/rulesets/chess/ladder.mjs';
import { fenBefore, isPlayerTurn } from './chessGameState.js';
import { useSettledGesture } from './useSettledGesture.js';

/** The tally shape the ladder speaks, from the one this controller keeps. */
const tallyOf = (used) => ({
  hints: used?.hints || 0,
  best_moves: used?.bestMoves || 0,
  takebacks: used?.takebacks || 0,
});

/**
 * Own hint, analysis, replay, and opening-stage state for one chess session.
 *
 * Takes the RAW gesture and settles it here rather than asking the caller to.
 * The caller needs the raw value for its own purposes — a recognised cluster
 * suppresses chord narrowing the instant it is physically down — but nothing
 * may be CHARGED for a shape the hand was only passing through. Keeping the
 * settle inside means a future caller cannot forget it.
 */
export function useChessHelpController({
  game,
  gameRef,
  gameId,
  userId,
  gesture: rawGesture,
  requestBestMove,
  logger,
  openingMs,
  replayHoldMs,
  replayMoveMs,
  policy = null,
  level = 0,
}) {
  const gesture = useSettledGesture(rawGesture);
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
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const levelRef = useRef(level);
  levelRef.current = level;

  /**
   * Does this match still count toward the round?
   *
   * DERIVED, never tracked. It asks `helpWithinCeilings` — the same predicate
   * the ladder uses to decide the finished game — so the badge on screen during
   * a match cannot disagree with the verdict at the end of it. A separate flag
   * kept in step by hand would drift, and a badge that lies is worse than no
   * badge at all.
   *
   * Only the help ceilings are knowable here. Whether the game was filed
   * against the right round is the server's to say, so a caller that cannot
   * offer a policy gets `null` — "not known" — rather than a confident yes.
   */
  const matchCounts = policy ? helpWithinCeilings(tallyOf(helpUsed), policy, level) : null;

  // Armed, awaiting a second press: the kind of help that would demote this
  // match to practice if it went through. Held in a ref for the gesture effect
  // (which must not re-run when the arm changes) and in state for the rail.
  const armedRef = useRef(null);
  const [demotionArmed, setDemotionArmed] = useState(null);

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

  /**
   * Arm before spending, but only when spending would actually cost something.
   *
   * Not a best-move special case: ask the ladder whether THIS press would push
   * the tally past a ceiling. One orienting hint is free and must stay
   * frictionless, so it passes straight through; the second one demotes, so it
   * asks first. A match already down to practice cannot be demoted twice, so
   * the warning stops rather than nagging.
   *
   * Returns true when the caller may proceed. The arm survives the release of
   * the cluster — a player has to let go before they can press again, so
   * clearing it on an empty hand would make confirming impossible. It is
   * cleared by playing a move instead: backing out costs nothing but carrying
   * on with the game.
   */
  const armOrProceed = useCallback((kind) => {
    const activePolicy = policyRef.current;
    if (!activePolicy) return true;
    const now = tallyOf(helpUsedRef.current);
    // Already practice — nothing left to warn about.
    if (!helpWithinCeilings(now, activePolicy, levelRef.current)) return true;
    const after = { ...now };
    if (kind === 'hint') after.hints += 1;
    else if (kind === 'best') after.best_moves += 1;
    else return true;
    if (helpWithinCeilings(after, activePolicy, levelRef.current)) return true;

    if (armedRef.current === kind) {
      armedRef.current = null;
      setDemotionArmed(null);
      logger.info('help-demotion-confirmed', { kind });
      return true;
    }
    armedRef.current = kind;
    setDemotionArmed(kind);
    logger.info('help-demotion-armed', { kind });
    return false;
  }, [logger]);

  useEffect(() => {
    if (gesture === 'hint' && !help.legal) {
      if (!isPlayerTurn(gameRef.current)) {
        logger.info('help-ignored', { kind: 'legal', reason: 'not_player_turn' });
      } else if (armOrProceed('hint')) {
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

    if (gesture === 'best' && !help.best && !requestTokenRef.current && armOrProceed('best')) {
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
    // Playing on is how a player declines. The arm does not survive a move.
    armedRef.current = null;
    setDemotionArmed(null);
  }, [game.history.length]);

  const addTakeback = useCallback(() => {
    setHelpUsed((value) => ({ ...value, takebacks: value.takebacks + 1 }));
  }, []);

  const resetHelp = useCallback(() => {
    requestTokenRef.current = null;
    armedRef.current = null;
    setDemotionArmed(null);
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
    // Does this match still count? null when no policy has been loaded, so a
    // caller can say "not known" rather than asserting a confident yes.
    matchCounts,
    // The kind of help awaiting a second press, or null.
    demotionArmed,
  };
}

export default useChessHelpController;
