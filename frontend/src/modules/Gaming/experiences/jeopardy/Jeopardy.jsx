// Jeopardy native presenter. Authoritative transitions and scores are owned by
// the shared ruleset and remote Gaming coordinator.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { currentRound } from '../../../../../../shared/gaming/rulesets/jeopardy/stateMachine.mjs';
import { resolveJeopardyKey } from './keymap.js';
import Scoreboard from '../../environments/group-play/presenters/Scoreboard.jsx';
import { useBuzzers } from '../../environments/group-play/interaction/useBuzzers.js';
import { AudioCueEngine } from '../../environments/group-play/effects/AudioCueEngine.js';
import { fetchSession } from '../../environments/group-play/app/sessionClient.js';
import { sendJeopardyCommand } from './jeopardyClient.js';
import TitleCard from '../../environments/group-play/ui/TitleCard.jsx';
import WagerPanel from '../../environments/group-play/ui/WagerPanel.jsx';
import Board from './Board.jsx';
import ClueScreen from './ClueScreen.jsx';
import FinalRound from './FinalRound.jsx';

export default function Jeopardy({ setId, teams, sessionId, buzzerBindings = null, config, onFinished }) {
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const scores = useMemo(() => state?.scores || {}, [state?.scores]);
  const audio = useMemo(() => new AudioCueEngine({ pack: config?.sounds?.pack, mute: config?.defaults?.mute }), [config]);
  const finishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionRef = useRef(() => {});

  const { arbiter, locked, arm, disarm } = useBuzzers({
    teams,
    onLock: (teamId) => { audio.play('buzz'); actionRef.current({ type: 'BUZZ', teamId }); },
  });

  // Press-to-bind results from the environment bind phase override team defaults.
  useEffect(() => {
    if (buzzerBindings) arbiter.restore({ slotToTeam: buzzerBindings });
  }, [arbiter, buzzerBindings]);

  // Load the coordinator projection, which includes the pinned content pack.
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        setState(session.state); setSet(session.state.set);
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
  }, [sessionId, setId]);

  // Single funnel: keyboard, on-screen buttons, and remote host commands all
  // call this. Reads live state via ref so it stays referentially stable.
  const applyAction = useCallback(async (action) => {
    if (!action || !stateRef.current) return;
    if (action.type === 'JUDGE' || action.type === 'JUDGE_FINAL') audio.play(action.correct ? 'correct' : 'wrong');
    else if (action.type === 'SELECT_TILE' || action.type === 'SELECT_AT') audio.play('reveal');
    else if (action.type === 'START_ROUND') audio.play('board-fill');
    else if (action.type === 'TIMEOUT') audio.play('wrong');
    try { const result = await sendJeopardyCommand(sessionId, action); setState(result.state); setSet(result.state.set); setError(null); }
    catch (cause) { setError(cause.message); }
  }, [audio, sessionId]);
  actionRef.current = applyAction;

  // Buzzer arming window (hosted/self buzz races only).
  useEffect(() => {
    if (!set || !state) return;
    const round = currentRound(state);
    const buzzable = state.phase === 'clue' && !state.isDailyDouble && round.mode !== 'turns' && !state.revealed;
    if (buzzable) arm(teamIds.filter((id) => !state.attempted.includes(id)));
    else disarm();
  }, [state?.phase, state?.attempted, state?.revealed, state?.isDailyDouble, set, arm, disarm, teamIds, state]);

  // Remote host commands (from the phone companion) → same funnel.
  useWebSocketSubscription('gaming', (msg) => {
    if (msg?.kind === 'session-updated' && msg.sessionId === sessionId) {
      fetchSession(sessionId).then((result) => { setState(result.state); setSet(result.state.set); }).catch((cause) => setError(cause.message));
    }
  }, [applyAction, sessionId]);

  // Finish
  useEffect(() => {
    if (state?.phase === 'done' && !finishedRef.current) {
      finishedRef.current = true;
      audio.play('win');
      onFinished?.(scores);
    }
  }, [state?.phase, scores, sessionId, audio, onFinished]);

  // Host keyboard (also fed by GamepadAdapter synthetic keys).
  useEffect(() => {
    const onKey = (e) => {
      if (!state) return;
      const action = resolveJeopardyKey({ phase: state.phase, revealed: state.revealed, key: e.key });
      if (action) applyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state?.phase, state?.revealed, state, applyAction]);

  if (error) return <div className="group-play__error">{error}</div>;
  if (!set || !state) return <TitleCard title="Loading…" />;

  const round = currentRound(state);
  const { phase } = state;
  const lockedTeam = teams.find((t) => t.id === (state.answeringTeamId || locked)) || null;
  const timerSeconds = round?.timer_seconds ?? config?.defaults?.timer_seconds ?? 12;

  return (
    <div className="jeopardy" data-phase={phase}>
      {phase === 'round-intro' && (
        <div className="jp-final">
          <TitleCard title={round.name} subtitle={`${set.title} — round ${state.roundIndex + 1}`} />
          <button type="button" autoFocus onClick={() => applyAction({ type: 'START_ROUND' })}>Start</button>
        </div>
      )}
      {phase === 'board' && (
        <Board round={round} used={state.used} roundIndex={state.roundIndex} cursor={state.cursor} />
      )}
      {phase === 'wager' && (
        <WagerPanel
          teamName={teams.find((t) => t.id === state.answeringTeamId)?.name || ''}
          score={Math.max(scores[state.answeringTeamId] ?? 0, 0)}
          roundMax={Math.max(...round.categories.flatMap((c) => c.clues.map((q) => q.value))) * round.multiplier}
          value={100}
          onChange={() => {}}
          onConfirm={(amount) => applyAction({ type: 'SET_WAGER', amount })}
        />
      )}
      {(phase === 'clue' || phase === 'judging') && (
        <ClueScreen
          key={`${state.roundIndex}:${state.active?.cat}:${state.active?.row}:${state.attempted.length}`}
          state={state}
          timerSeconds={timerSeconds}
          onTimeout={() => applyAction({ type: 'TIMEOUT' })}
          lockedTeam={lockedTeam}
        />
      )}
      {['final-category', 'final-wager', 'final-clue', 'final-judging'].includes(phase) && (
        <FinalRound state={state} teams={teams} scores={scores} onAction={applyAction} />
      )}
      <Scoreboard teams={teams} scores={scores} lockedTeamId={state.answeringTeamId} activeTeamId={state.turnTeamId} />
    </div>
  );
}
