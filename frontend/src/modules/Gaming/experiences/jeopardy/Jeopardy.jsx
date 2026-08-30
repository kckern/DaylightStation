// Jeopardy native presenter. Authoritative transitions and scores are owned by
// the shared ruleset and remote Gaming coordinator.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { currentRound } from '../../../../../../shared/gaming/rulesets/jeopardy/stateMachine.mjs';
import { resolveJeopardyKey } from './keymap.js';
import Scoreboard from '@gaming-ui/Scoreboard.jsx';
import { fetchSession } from '@gaming/platform/api/sessionClient.js';
import { sendJeopardyCommand } from './jeopardyClient.js';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import WagerPanel from './ui/WagerPanel.jsx';
import Board from './Board.jsx';
import ClueScreen from './ClueScreen.jsx';
import FinalRound from './FinalRound.jsx';
import ShowHeader from '@gaming-ui/ShowHeader.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';

const SILENT_AUDIO = Object.freeze({ play() {} });
const NO_BUZZERS = Object.freeze({
  locked: null,
  arm() {},
  disarm() {},
  subscribe() { return () => {}; },
});

const roundMultiplier = (round) => Number(round?.multiplier ?? 1);

export default function Jeopardy({ setId, seats = [], sessionId, config, gamingServices, onComplete }) {
  const teams = seats;
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [wagerDraft, setWagerDraft] = useState(100);
  const scores = useMemo(() => state?.scores || {}, [state?.scores]);
  const audio = gamingServices?.audio || SILENT_AUDIO;
  const buzzers = gamingServices?.buzzers || NO_BUZZERS;
  const finishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionRef = useRef(() => {});

  useEffect(() => {
    return buzzers.subscribe((teamId) => {
      audio.play('buzz');
      actionRef.current({ type: 'BUZZ', teamId });
    });
  }, [audio, buzzers]);

  // Load the coordinator projection, which includes the pinned content pack.
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        setState(session.state); setSet(session.state.set); setCompletion(session.result || null);
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
    try { const result = await sendJeopardyCommand(sessionId, action); setState(result.state); setSet(result.state.set); setCompletion(result.result || null); setError(null); }
    catch (cause) { setError(cause.message); }
  }, [audio, sessionId]);
  actionRef.current = applyAction;

  // Buzzer arming window (hosted/self buzz races only).
  useEffect(() => {
    if (!set || !state) return;
    const round = currentRound(state);
    const buzzable = state.phase === 'clue' && !state.isDailyDouble && round.mode !== 'turns' && !state.revealed;
    if (buzzable) buzzers.arm(teamIds.filter((id) => !state.attempted.includes(id)));
    else buzzers.disarm();
  }, [state?.phase, state?.attempted, state?.revealed, state?.isDailyDouble, set, buzzers, teamIds, state]);

  // Remote host commands (from the phone companion) → same funnel.
  useWebSocketSubscription('gaming', (msg) => {
    if (msg?.kind === 'session-updated' && msg.sessionId === sessionId) {
      fetchSession(sessionId).then((result) => { setState(result.state); setSet(result.state.set); setCompletion(result.result || null); }).catch((cause) => setError(cause.message));
    }
  }, [applyAction, sessionId]);

  // Finish
  useEffect(() => {
    if (state?.phase === 'done' && completion && !finishedRef.current) {
      finishedRef.current = true;
      audio.play('win');
      onComplete?.(completion);
    }
  }, [state?.phase, completion, audio, onComplete]);

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

  if (error) return <div className="party-games__error">{error}</div>;
  if (!set || !state) return <TitleCard title="Loading…" />;

  const round = currentRound(state);
  const { phase } = state;
  const lockedTeam = teams.find((t) => t.id === (state.answeringTeamId || buzzers.locked)) || null;
  const timerSeconds = round?.timer_seconds ?? config?.defaults?.timer_seconds ?? 12;

  return (
    <div className="jeopardy" data-phase={phase}>
      {phase !== 'round-intro' && !phase.startsWith('final-') && <ShowHeader eyebrow={round?.name} title={set.title} status={phase === 'board' ? `Round ${state.roundIndex + 1}` : state.active ? round.categories[state.active.cat]?.name : null} />}
      {phase === 'round-intro' && (
        <div className="jp-final">
          <TitleCard title={round.name} subtitle={`${set.title} — round ${state.roundIndex + 1}`} />
          <GameButton tone="primary" autoFocus onClick={() => applyAction({ type: 'START_ROUND' })}>Fill the board</GameButton>
        </div>
      )}
      {phase === 'board' && (
        <Board round={round} used={state.used} roundIndex={state.roundIndex} cursor={state.cursor} onSelect={(cat, row) => applyAction({ type: 'SELECT_AT', cat, row })} />
      )}
      {phase === 'wager' && (
        <WagerPanel
          teamName={teams.find((t) => t.id === state.answeringTeamId)?.name || ''}
          score={Math.max(scores[state.answeringTeamId] ?? 0, 0)}
          roundMax={Math.max(...round.categories.flatMap((c) => c.clues.map((q) => q.value))) * roundMultiplier(round)}
          value={wagerDraft}
          onChange={setWagerDraft}
          onConfirm={(amount) => { applyAction({ type: 'SET_WAGER', amount }); setWagerDraft(100); }}
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
