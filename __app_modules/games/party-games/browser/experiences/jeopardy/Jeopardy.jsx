// Jeopardy native presenter. Authoritative transitions and scores are owned by
// the shared ruleset and remote Gaming coordinator.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';
import { currentRound, playableCursor } from "../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/stateMachine.mjs";
import { resolveJeopardyKey, remoteActionKey } from "./keymap.js";
import Scoreboard from "../../../../../../__capabilities/gaming/browser/platform/ui/Scoreboard.jsx";
import { fetchSession } from "../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js";
import { sendJeopardyCommand } from "./jeopardyClient.js";
import { JEOPARDY_PACK, actionCue, phaseCues } from "./jeopardyCues.js";
import TitleCard from "../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx";
import WagerPanel from "./ui/WagerPanel.jsx";
import ControlLegend from "../../../../../../__capabilities/gaming/browser/platform/ui/ControlLegend.jsx";
import Board from "./Board.jsx";
import ClueScreen from "./ClueScreen.jsx";
import FinalRound from "./FinalRound.jsx";
import ShowHeader from "../../../../../../__capabilities/gaming/browser/platform/ui/ShowHeader.jsx";
import GameButton from "../../../../../../__capabilities/gaming/browser/platform/ui/GameButton.jsx";

const SILENT_AUDIO = Object.freeze({ play() {}, stopChannel() {} });
const NO_BUZZERS = Object.freeze({
  locked: null,
  arm() {},
  disarm() {},
  subscribe() { return () => {}; },
});

const BUTTON_ACTION_PHASES = { START_ROUND: ['round-intro', 'final-category'], SET_WAGER: ['wager'], SET_FINAL_WAGER: ['final-wager'], JUDGE_FINAL: ['final-judging'] };

const roundMultiplier = (round) => Number(round?.multiplier ?? 1);

export default function Jeopardy({ setId, seats = [], sessionId, config, gamingServices, onComplete, registerRemoteAction }) {
  const teams = seats;
  const logger = useMemo(() => getLogger().child({ component: 'jeopardy', sessionId }), [sessionId]);
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const errorRef = useRef(error);
  errorRef.current = error;
  const [completion, setCompletion] = useState(null);
  const [wagerDraft, setWagerDraft] = useState(100);
  const [finalWagerDrafts, setFinalWagerDrafts] = useState({});
  useEffect(() => { if (state?.phase !== 'wager') setWagerDraft(100); }, [state?.phase]);
  const scores = useMemo(() => state?.scores || {}, [state?.scores]);
  const audio = gamingServices?.audio || SILENT_AUDIO;
  const buzzers = gamingServices?.buzzers || NO_BUZZERS;
  const finishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingCommand = useRef(false);
  const actionRef = useRef(() => {});

  useEffect(() => {
    return buzzers.subscribe((teamId) => {
      audio.play('buzz', { pack: JEOPARDY_PACK });
      actionRef.current({ type: 'BUZZ', teamId });
    });
  }, [audio, buzzers]);

  const acceptSession = useCallback((session) => {
    // Input can arrive after the HTTP acknowledgment and before React paints.
    stateRef.current = session.state;
    errorRef.current = null;
    setState(session.state); setSet(session.state.set); setCompletion(session.result || null); setError(null);
  }, []);

  // Load the coordinator projection, which includes the pinned content pack.
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        acceptSession(session);
      })
      .catch((err) => { errorRef.current = err.message; setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId, setId, acceptSession]);

  // Single funnel: keyboard, on-screen buttons, and remote host commands all
  // call this. Reads live state via ref so it stays referentially stable.
  const applyAction = useCallback(async (action) => {
    if (!action || !stateRef.current || pendingCommand.current) return;
    const current = stateRef.current;
    // A button from the previous render may still receive a second activation
    // after the response arrives. Do not replay its completed team action.
    if (BUTTON_ACTION_PHASES[action.type] && !BUTTON_ACTION_PHASES[action.type].includes(current.phase)) return;
    if (action.type === 'JUDGE_FINAL' && current.finalJudged?.[action.teamId] != null) return;
    if (action.type === 'SET_FINAL_WAGER' && current.finalWagers?.[action.teamId] != null) return;
    pendingCommand.current = true;
    const cue = actionCue(action); if (cue) audio.play(cue, { pack: JEOPARDY_PACK });
    try { const result = await sendJeopardyCommand(sessionId, action); acceptSession(result); }
    catch (cause) { logger.warn('jeopardy.command-failed', { type: action.type, phase: stateRef.current?.phase, error: cause.message }); errorRef.current = cause.message; setError(cause.message); }
    finally { pendingCommand.current = false; }
  }, [audio, sessionId, logger, acceptSession]);
  const recoverConnection = useCallback(async () => {
    if (pendingCommand.current) return;
    pendingCommand.current = true;
    logger.info('jeopardy.connection-retry', { sessionId });
    try {
      const session = await fetchSession(sessionId);
      acceptSession(session);
      logger.info('jeopardy.connection-recovered', { phase: session.state.phase });
    } catch (cause) {
      logger.warn('jeopardy.connection-retry-failed', { error: cause.message });
      errorRef.current = cause.message; setError(cause.message);
    } finally { pendingCommand.current = false; }
  }, [sessionId, logger, acceptSession]);
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
      fetchSession(sessionId).then((result) => { acceptSession(result); }).catch((cause) => { errorRef.current = cause.message; setError(cause.message); });
    }
  }, [applyAction, sessionId, acceptSession]);

  // Finish
  useEffect(() => {
    if (state?.phase === 'done' && completion && !finishedRef.current) {
      finishedRef.current = true;
      audio.play('win', { pack: JEOPARDY_PACK });
      onComplete?.(completion);
    }
  }, [state?.phase, completion, audio, onComplete]);

  // Phase music (theme on the round title card, think music under Final) and
  // phase stings (Daily Double). Music stops when the phase moves on.
  useEffect(() => {
    if (!state?.phase) return undefined;
    const { music, sting } = phaseCues(state.phase);
    if (sting) audio.play(sting, { pack: JEOPARDY_PACK });
    if (!music) return undefined;
    audio.play(music, { pack: JEOPARDY_PACK, channel: 'music', loop: music === 'theme', volume: music === 'theme' ? 0.5 : 1 });
    return () => audio.stopChannel('music');
  }, [state?.phase, audio]);

  // Host keyboard (also fed by GamepadAdapter synthetic keys).
  useEffect(() => {
    const onKey = (e) => {
      const state = stateRef.current;
      if (!state || errorRef.current) return;
      const action = resolveJeopardyKey({ phase: state.phase, revealed: state.revealed, answeringTeamId: state.answeringTeamId, mode: currentRound(state)?.mode, key: e.key });
      if (action) applyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state?.phase, state?.revealed, state, applyAction, error]);

  // Inside Party Games the shell captures remote keys; it offers each action here
  // first. Claim only what this phase's key matrix uses, so wager and intro
  // buttons keep ordinary focus navigation.
  useEffect(() => registerRemoteAction?.((remote) => {
    const state = stateRef.current;
    if (!state || errorRef.current) return false;
    if (remote.repeat && state.phase !== 'board') return true;
    const key = remoteActionKey(remote);
    const action = key && resolveJeopardyKey({ phase: state.phase, revealed: state.revealed, answeringTeamId: state.answeringTeamId, mode: currentRound(state)?.mode, key });
    if (!action) return false;
    logger.debug('jeopardy.remote-action', { phase: state.phase, key, type: action.type });
    applyAction(action);
    return true;
  }), [registerRemoteAction, state, applyAction, logger, error]);

  if (error) return <div className="party-games__error" role="alert">
    <strong>Game connection interrupted</strong>
    <span>{error}</span>
    <GameButton tone="primary" autoFocus onClick={recoverConnection}>Retry connection</GameButton>
  </div>;
  if (!set || !state) return <TitleCard title="Loading…" />;

  const round = currentRound(state);
  const { phase } = state;
  const lockedTeam = teams.find((t) => t.id === (state.answeringTeamId || buzzers.locked)) || null;
  const timerSeconds = round?.timer_seconds ?? config?.defaults?.timer_seconds ?? 12;

  return (
    <div className="jeopardy" data-phase={phase}>
      {phase !== 'round-intro' && !phase.startsWith('final-') && <ShowHeader eyebrow={round?.name} title={set.title} status={phase === 'board' ? `${teams.find(team => team.id === state.turnTeamId)?.name || 'Next team'} chooses — Round ${state.roundIndex + 1}` : state.active ? round.categories[state.active.cat]?.name : null} />}
      {phase === 'round-intro' && (
        <div className="jp-final">
          <TitleCard title={round.name} subtitle={`${set.title} — round ${state.roundIndex + 1}`} />
          <GameButton tone="primary" autoFocus onClick={() => applyAction({ type: 'START_ROUND' })}>Fill the board</GameButton>
        </div>
      )}
      {phase === 'board' && (
        <><Board round={round} used={state.used} roundIndex={state.roundIndex} cursor={playableCursor(state) || state.cursor} onSelect={(cat, row) => applyAction({ type: 'SELECT_AT', cat, row })} /><ControlLegend items={[{ key: 'Arrows', label: 'Choose a question' }, { key: 'OK', label: 'Open question' }]} /></>
      )}
      {phase === 'wager' && (
        <WagerPanel
          teamName={teams.find((t) => t.id === state.answeringTeamId)?.name || ''}
          score={Math.max(scores[state.answeringTeamId] ?? 0, 0)}
          roundMax={Math.max(...round.categories.flatMap((c) => c.clues.map((q) => q.value))) * roundMultiplier(round)}
          value={wagerDraft}
          onChange={setWagerDraft}
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
        <FinalRound state={state} teams={teams} scores={scores} wagerDrafts={finalWagerDrafts} onWagerChange={(teamId, amount) => setFinalWagerDrafts(drafts => ({ ...drafts, [teamId]: amount }))} onAction={applyAction} />
      )}
      <Scoreboard teams={teams} scores={scores} lockedTeamId={state.answeringTeamId} activeTeamId={state.turnTeamId} />
    </div>
  );
}
