import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildGameArchive } from './chessGameArchive.js';
import { buildGameRecord } from './chessGameRecord.js';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

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
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;
  const loggerRef = useRef(logger);
  loggerRef.current = logger;
  const mountedRef = useRef(false);
  const archiveInputsRef = useRef(null);
  const completionInputsRef = useRef(null);
  const [finishedState, setFinishedState] = useState({ gameId: null, value: null });
  const [ladderState, setLadderState] = useState({ gameId: null, value: null });

  const lifecycle = lifecycleRef.current;
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

  const archiveAbandonedGame = useCallback((useBeacon = false) => {
    const active = lifecycleRef.current;
    const inputs = archiveInputsRef.current;
    if (!active || active.archived || !inputs || inputs.gameId !== active.gameId) return;
    const archive = buildGameArchive({ ...inputs, endedAt: Date.now(), endedBy: 'left' });
    if (!archive) return;
    active.archived = true;
    const currentGateway = gatewayRef.current;
    if (!useBeacon || !currentGateway.beaconArchive(archive)) currentGateway.archiveGame(archive);
  }, []);

  useEffect(() => {
    const flush = (event) => {
      // A BFCache pagehide is suspension, not departure. The same JS session may
      // resume and finish this game; archiving here would create two histories.
      if (event?.persisted === true) return;
      archiveAbandonedGame(true);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [archiveAbandonedGame]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loggerRef.current.info('unmounted');
      archiveAbandonedGame(false);
    };
  }, [archiveAbandonedGame]);

  useEffect(() => {
    const active = lifecycleRef.current;
    if (!game.status?.game_over || active.gameId !== gameId || active.recorded) return;
    active.recorded = true;
    const inputs = completionInputsRef.current;
    const endedAt = Date.now();
    const record = buildGameRecord({ ...inputs, endedAt });
    setFinishedState({ gameId, value: record });
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
  }, [game.status?.game_over, gameId, userId]);

  const endTiming = useMemo(() => {
    if (!game.status?.game_over || timing.mode === 'off') return null;
    const ledger = timingLedgerRef?.current;
    if (ledger?.quality !== 'complete') return null;
    const totalMs = game.history.reduce((sum, _entry, index) => sum + (ledger.byPly[index + 1] || 0), 0);
    return { timed: true, totalMs };
  }, [game.history, game.status?.game_over, timing.mode, timingLedgerRef]);

  return {
    startedAt: lifecycle.startedAt,
    finishedRecord: finishedState.gameId === gameId ? finishedState.value : null,
    ladderOutcome: ladderState.gameId === gameId ? ladderState.value : null,
    endTiming,
  };
}

export default useChessPersistenceLifecycle;
