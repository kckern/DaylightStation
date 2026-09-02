import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildGameArchive } from './chessGameArchive.js';
import { buildGameRecord } from './chessGameRecord.js';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

// How long a finished game waits for its rung before it is filed without one.
// A read that never answers must cost the record its level, never the record.
const LADDER_SETTLE_TIMEOUT_MS = 5000;

function freshLifecycle(gameId) {
  return {
    gameId,
    archived: false,
    recorded: false,
    startedAt: Date.now(),
  };
}

/** Persist one completed game and archive any played game on every genuine exit path. */
export function useChessPersistenceLifecycle({
  game,
  gameId,
  userId,
  rungId,
  ladderLevel,
  // Whether the ladder read has ANSWERED — not whether it produced a ladder.
  // `ladderLevel` is null until it does, and `buildGameRecord` files a null
  // level as "unknown", which the shared ladder declines to count: a slow read
  // costs a genuinely played game its promotion. A caller with no ladder read
  // to wait for says so by leaving this alone.
  ladderReady = true,
  addressing,
  opponentRef,
  helpUsed,
  timing,
  playerColor: _playerColor,
  commentary = null,
  timingLedgerRef = null,
  logger,
  gateway,
}) {
  const matchGate = useContext(MatchGateContext);
  const matchGateRef = useRef(matchGate);
  matchGateRef.current = matchGate;
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current || lifecycleRef.current.gameId !== gameId) {
    lifecycleRef.current = freshLifecycle(gameId);
  }
  // HOW FAR THIS COMPONENT ACTUALLY WATCHED THIS GAME GET, while it was still
  // playable. A match played out here passes through every ply but its last; a
  // transcript that arrived already finished never does, and that difference is
  // the only thing separating a real result from a phantom. Five phantoms
  // reached one child's chess history in August — same move count as a real
  // game earlier the same day, `level: null`, `opponent: null`, three to six
  // seconds of "play". See
  // docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
  //
  // Keyed by game id and reset HERE, in the render body beside the lifecycle
  // it belongs to: an identity that moves on while the terminal board is still
  // mounted must not inherit the finished match's high-water mark, or the very
  // duplicate this guard exists to refuse walks straight through it.
  const watchedRef = useRef({ gameId: null, plies: -1 });
  if (watchedRef.current.gameId !== gameId) watchedRef.current = { gameId, plies: -1 };
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const loggerRef = useRef(logger);
  loggerRef.current = logger;
  const mountedRef = useRef(false);
  const archiveInputsRef = useRef(null);
  const completionInputsRef = useRef(null);
  const pendingFileRef = useRef(null);
  const endedAtRef = useRef({ gameId: null, at: 0 });
  // The phantom we have already complained about, keyed `game:plies` — hence
  // "phantom" and not "game": a render storm collapses to one warning, while a
  // genuinely different phantom in the same game still speaks.
  const warnedPhantomRef = useRef(null);
  const [finishedState, setFinishedState] = useState({ gameId: null, value: null });
  const [ladderState, setLadderState] = useState({ gameId: null, value: null });
  const [ladderTimedOut, setLadderTimedOut] = useState(false);

  const lifecycle = lifecycleRef.current;
  const plies = game.history?.length || 0;
  const gameOver = !!game.status?.game_over;
  const sharedInputs = {
    game,
    gameId,
    userId,
    rungId,
    addressing,
    opponent: opponentRef.current,
    hints: helpUsed.hints,
    bestMoves: helpUsed.bestMoves,
    takebacks: helpUsed.takebacks,
    startedAt: lifecycle.startedAt,
    timing,
    commentary: commentary?.current || commentary,
    timingLedger: timingLedgerRef?.current || null,
  };
  archiveInputsRef.current = sharedInputs;
  completionInputsRef.current = { ...sharedInputs, level: ladderLevel };

  // FAIL OPEN. A ladder read that never answers must not strand a played game
  // unfiled — so the wait is bounded, and what lies past it is an honest
  // `level: null` rather than a guess. A guessed rung is worse than none here:
  // `buildGameRecord` refuses to count an unknown level, but it would count a
  // guessed one, and promote a child off a rung they never played.
  useEffect(() => {
    if (ladderReady) return undefined;
    setLadderTimedOut(false);
    const timer = setTimeout(() => {
      loggerRef.current.warn?.('ladder-read-slow', { gameId, timeoutMs: LADDER_SETTLE_TIMEOUT_MS });
      setLadderTimedOut(true);
    }, LADDER_SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [gameId, ladderReady]);
  const ladderSettled = ladderReady || ladderTimedOut;

  const archiveAbandonedGame = useCallback((useBeacon = false) => {
    const active = lifecycleRef.current;
    const inputs = archiveInputsRef.current;
    if (!active || active.archived || !inputs || inputs.gameId !== active.gameId) return;
    // ...but only a game this component actually played. Refusing a phantom
    // result and then filing the same transcript as abandoned on the way out
    // just trades a duplicate for a junk row.
    //
    // Strict, not `- 1`: no terminal ply lands here. A game that finished has
    // set `archived` — when it filed, or in the flush on the way out — and
    // returned above.
    const watched = watchedRef.current;
    const played = inputs.game?.history?.length || 0;
    if (played && (watched.gameId !== active.gameId || watched.plies < played)) {
      loggerRef.current.warn?.('game-abandon-refused', {
        gameId: active.gameId, plies: played, watchedPlies: watched.plies, reason: 'not-played-here',
      });
      return;
    }
    const archive = buildGameArchive({ ...inputs, endedAt: Date.now(), endedBy: 'left' });
    if (!archive) return;
    active.archived = true;
    const currentGateway = gatewayRef.current;
    if (!useBeacon || !currentGateway.beaconArchive(archive)) currentGateway.archiveGame(archive);
  }, []);

  // A result parked waiting for its rung, carried out rather than dropped.
  const flushPendingResult = useCallback(() => {
    const deferred = pendingFileRef.current;
    pendingFileRef.current = null;
    deferred?.file();
  }, []);

  useEffect(() => {
    const flush = (event) => {
      // A BFCache pagehide is suspension, not departure. The same JS session may
      // resume and finish this game; archiving here would create two histories.
      if (event?.persisted === true) return;
      flushPendingResult();
      archiveAbandonedGame(true);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [archiveAbandonedGame, flushPendingResult]);

  // THE CLEANUP BELOW DEPENDS ON EFFECT ORDER. React tears effects down in
  // declaration order, so the parked result is carried out and then judged as
  // abandoned in ONE cleanup, in the textual order written here — and the
  // recording effect below must never grow a cleanup of its own, or it would
  // clear the parked result before this ever sees it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loggerRef.current.info('unmounted');
      // A result still waiting on the ladder when the screen goes away. The
      // match gate unmounts this game on "play again", so this is an ordinary
      // path and not a curiosity — and filing it here is what keeps the
      // abandon guard's premise true: a finished game has set `archived` by
      // the time that guard runs.
      flushPendingResult();
      archiveAbandonedGame(false);
    };
  }, [archiveAbandonedGame, flushPendingResult]);

  // Declared BEFORE the recording effect, so on any commit it runs first and
  // the recording effect always sees a count that includes the render it is
  // judging. A terminal board is skipped on purpose: watching a game end is
  // exactly what the recording effect is about to ask about.
  useEffect(() => {
    if (gameOver) return;
    const watched = watchedRef.current;
    watched.plies = Math.max(watched.plies, plies);
  }, [gameId, gameOver, plies]);

  useEffect(() => {
    const active = lifecycleRef.current;

    // A DEFERRAL MEANS WAIT, NEVER LOSE. An ordinary re-render rebuilds the
    // parked filing from scratch, which is how the settled rung gets into it.
    // But a render that is no longer the deferred match's own — a new game
    // after "play again", a new child after a profile switch — cannot stand in
    // for the render that deferred, and rebuilding there would file that match
    // under the wrong identity. So it carries it out instead. (The third way
    // out, an unmount, is handled in the cleanup above.)
    const deferred = pendingFileRef.current;
    if (deferred && (!gameOver || deferred.gameId !== gameId || deferred.userId !== userId)) {
      pendingFileRef.current = null;
      deferred.file();
    }

    if (!gameOver || active.gameId !== gameId || active.recorded) return;

    // The moment the game ended, frozen once per game: a filing that waits for
    // its rung must not report the waiting as time the child spent playing.
    if (endedAtRef.current.gameId !== gameId) endedAtRef.current = { gameId, at: Date.now() };
    const endedAt = endedAtRef.current.at;
    const inputs = completionInputsRef.current;
    const record = buildGameRecord({ ...inputs, endedAt });
    // The card is about the SCREEN, and the board in front of the child says
    // the game is over whether or not we are willing to file it. Display is
    // published now; only the ledger waits, and only the ledger refuses.
    setFinishedState({ gameId, value: record });

    // EVERYTHING THE FILING NEEDS IS FROZEN HERE, not read back off the refs
    // when the filing happens: a flush runs at least one render later, and by
    // then a restart has published the next match's rung, opponent and
    // commentary. Read live, those blend two matches together.
    const watched = watchedRef.current.gameId === gameId ? watchedRef.current.plies : -1;
    const finalPlies = plies;
    const file = (flushed = false) => {
      if (active.recorded) return;
      // CONTRACT: ONE PLY PER COMMIT. A match played here is committed a ply at
      // a time — the player's move and the engine's reply land in separate
      // renders — so the render before its last leaves `watched` exactly one
      // short. That is the whole meaning of the `- 1`.
      if (watched < 0 || watched < finalPlies - 1) {
        // A refusal is a judgement about the TRANSCRIPT in front of us on this
        // render, never about the game. `recorded` means "this game's result
        // has been FILED", and a refusal files nothing, so it has no business
        // closing the one-shot: leave it open and a game that really is played
        // afterwards can still file.
        const phantom = `${gameId}:${finalPlies}`;
        if (warnedPhantomRef.current !== phantom) {
          warnedPhantomRef.current = phantom;
          loggerRef.current.warn?.('game-record-refused', {
            gameId,
            plies: finalPlies,
            watchedPlies: watched,
            result: record?.result ?? null,
            reason: 'not-played-here',
          });
        }
        return;
      }
      active.recorded = true;
      if (flushed) {
        // Filed by the way out rather than the front door: the ladder read was
        // still hanging when this match lost its screen, so the level below is
        // whatever had answered by then and not necessarily the child's.
        loggerRef.current.warn?.('game-record-flushed', {
          gameId, level: record?.level ?? null, plies: finalPlies,
        });
      }
      if (record && userId) {
        const request = Promise.resolve(gatewayRef.current.saveGameRecord(userId, record));
        matchGateRef.current?.registerCompletion?.(request);
        request.then((saved) => {
          if (!mountedRef.current || lifecycleRef.current.gameId !== gameId) return;
          if (saved?.ladder) setLadderState({ gameId, value: saved.ladder });
        }).catch((error) => {
          loggerRef.current.warn?.('game-record-save-failed', { gameId, error: error?.message });
        });
      }
      loggerRef.current.info('game-recorded', { ...(record || {}), persisted: !!(record && userId) });
      if (!active.archived) {
        const archive = buildGameArchive({ ...inputs, endedAt, endedBy: 'game_over' });
        if (archive) gatewayRef.current.archiveGame(archive);
        active.archived = true;
      }
    };

    // WAIT FOR THE RUNG. Not a refusal and not a filing — the same result is
    // judged again the moment the ladder answers, so this comes after the
    // display is published and before the one-shot can be spent.
    if (!ladderSettled) {
      pendingFileRef.current = { gameId, userId, file: () => file(true) };
      return;
    }
    file();
  }, [gameOver, gameId, ladderSettled, plies, userId]);

  const endTiming = useMemo(() => {
    if (!gameOver || timing.mode === 'off') return null;
    const ledger = timingLedgerRef?.current;
    if (ledger?.quality !== 'complete') return null;
    const totalMs = game.history.reduce((sum, _entry, index) => sum + (ledger.byPly[index + 1] || 0), 0);
    return { timed: true, totalMs };
  }, [game.history, gameOver, timing.mode, timingLedgerRef]);

  return {
    startedAt: lifecycle.startedAt,
    finishedRecord: finishedState.gameId === gameId ? finishedState.value : null,
    ladderOutcome: ladderState.gameId === gameId ? ladderState.value : null,
    endTiming,
  };
}

export default useChessPersistenceLifecycle;
