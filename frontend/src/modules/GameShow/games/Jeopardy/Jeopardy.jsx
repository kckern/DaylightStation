// Game orchestrator: owns the reducer, scores, buzzers, audio, timer,
// checkpointing, and the host-companion command/state bridge. Every state
// change flows through applyAction() so keyboard, on-screen buttons, and the
// mobile host all share one path (and score math happens exactly once).
import React, { useReducer, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { useWebSocketSubscription, useWebSocketSend } from '@/hooks/useWebSocket.js';
import { initJeopardy, jeopardyReducer, scoreDelta, snapshot, currentRound } from './jeopardyReducer.js';
import { resolveJeopardyKey } from './keymap.js';
import { scoreReducer, initScores } from '../../shell/scoreboard/scoreReducer.js';
import Scoreboard from '../../shell/scoreboard/Scoreboard.jsx';
import { useBuzzers } from '../../shell/buzzers/useBuzzers.js';
import { AudioCueEngine } from '../../shell/audio/AudioCueEngine.js';
import { makeCheckpointer, finishSession } from '../../shell/session/sessionClient.js';
import TitleCard from '../../shell/components/TitleCard.jsx';
import WagerPanel from '../../shell/components/WagerPanel.jsx';
import Board from './Board.jsx';
import ClueScreen from './ClueScreen.jsx';
import FinalRound from './FinalRound.jsx';

const EMPTY_SET = { rounds: [], final: null };

export default function Jeopardy({ setId, teams, sessionId, resumeState = null, buzzerBindings = null, config, onFinished }) {
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, dispatchGame] = useReducer(jeopardyReducer, teamIds, (ids) => initJeopardy(EMPTY_SET, ids));
  const [scores, dispatchScores] = useReducer(scoreReducer, teams, initScores);
  const audio = useMemo(() => new AudioCueEngine({ pack: config?.sounds?.pack, mute: config?.defaults?.mute }), [config]);
  const checkpointer = useMemo(() => makeCheckpointer(), []);
  const wsSend = useWebSocketSend();
  const finishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { arbiter, locked, arm, disarm } = useBuzzers({
    teams,
    onLock: (teamId) => { audio.play('buzz'); dispatchGame({ type: 'BUZZ', teamId }); },
  });

  // Press-to-bind results from the bind phase override team default slots.
  // (resumeState.buzzers, applied in the load effect, wins over these.)
  useEffect(() => {
    if (buzzerBindings) arbiter.restore({ slotToTeam: buzzerBindings });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply once on mount
  }, []);

  // Load the set, then seed the reducer with it (INIT_SET keeps state.set so
  // every reducer action reads the real content). Resume snapshot folds in.
  useEffect(() => {
    let cancelled = false;
    DaylightAPI(`api/v1/gameshow/games/jeopardy/sets/${setId}`)
      .then((loaded) => {
        if (cancelled) return;
        setSet(loaded);
        dispatchGame({ type: 'INIT_SET', set: loaded, resume: resumeState?.jeopardy || null });
        if (resumeState) {
          dispatchScores({ type: 'RESTORE', scores: resumeState.scores || {} });
          if (resumeState.buzzers) arbiter.restore(resumeState.buzzers);
        }
      })
      .catch((err) => setError(err.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  // Single funnel: keyboard, on-screen buttons, and remote host commands all
  // call this. Reads live state via ref so it stays referentially stable.
  const applyAction = useCallback((action) => {
    if (!action) return;
    const s = stateRef.current;
    switch (action.type) {
      case 'JUDGE': {
        const d = scoreDelta(s, action.correct);
        if (d && d.delta !== 0) dispatchScores({ type: d.delta > 0 ? 'AWARD' : 'DEDUCT', teamId: d.teamId, points: Math.abs(d.delta) });
        audio.play(action.correct ? 'correct' : 'wrong');
        dispatchGame({ type: 'JUDGE', correct: action.correct });
        break;
      }
      case 'JUDGE_FINAL': {
        const wager = s.finalWagers[action.teamId] || 0;
        if (wager > 0) dispatchScores({ type: action.correct ? 'AWARD' : 'DEDUCT', teamId: action.teamId, points: wager });
        audio.play(action.correct ? 'correct' : 'wrong');
        dispatchGame(action);
        break;
      }
      case 'SELECT_TILE': case 'SELECT_AT': audio.play('reveal'); dispatchGame(action); break;
      case 'START_ROUND': audio.play('board-fill'); dispatchGame(action); break;
      case 'TIMEOUT': audio.play('wrong'); dispatchGame(action); break;
      default: dispatchGame(action);
    }
  }, [audio]);

  // Buzzer arming window (hosted/self buzz races only).
  useEffect(() => {
    if (!set) return;
    const round = currentRound(state);
    const buzzable = state.phase === 'clue' && !state.isDailyDouble && round.mode !== 'turns' && !state.revealed;
    if (buzzable) arm(teamIds.filter((id) => !state.attempted.includes(id)));
    else disarm();
  }, [state.phase, state.attempted, state.revealed, state.isDailyDouble, set, arm, disarm, teamIds, state]);

  // Persist a checkpoint (debounced → disk, for resume).
  useEffect(() => {
    if (!sessionId || !set) return;
    checkpointer.push(sessionId, { jeopardy: snapshot(state), scores, buzzers: arbiter.snapshot() });
  }, [state, scores, sessionId, set, checkpointer, arbiter]);

  // Live state mirror → mobile host companion (realtime, un-debounced WS).
  useEffect(() => {
    if (!set || !sessionId) return;
    wsSend({ source: 'gameshow-state', topic: 'gameshow', kind: 'state', sessionId, snapshot: { jeopardy: snapshot(state), scores } });
  }, [state, scores, set, sessionId, wsSend]);

  // Remote host commands (from the phone companion) → same funnel.
  useWebSocketSubscription('gameshow', (msg) => {
    if (msg?.kind === 'command' && msg.sessionId === sessionId && msg.command) applyAction(msg.command);
  }, [applyAction, sessionId]);

  // Finish
  useEffect(() => {
    if (state.phase === 'done' && !finishedRef.current) {
      finishedRef.current = true;
      audio.play('win');
      if (sessionId) { checkpointer.flush(); finishSession(sessionId); }
      onFinished?.(scores);
    }
  }, [state.phase, scores, sessionId, audio, checkpointer, onFinished]);

  // Host keyboard (also fed by GamepadAdapter synthetic keys).
  useEffect(() => {
    const onKey = (e) => {
      const action = resolveJeopardyKey({ phase: state.phase, revealed: state.revealed, key: e.key });
      if (action) applyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase, state.revealed, applyAction]);

  if (error) return <div className="gameshow__error">{error}</div>;
  if (!set) return <TitleCard title="Loading…" />;

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
