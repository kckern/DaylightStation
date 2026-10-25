// Jeopardy native presenter. Authoritative transitions and scores are owned by
// the shared ruleset and remote Gaming coordinator.
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { wsService } from '@/services/WebSocketService.js';
import getLogger from '@/lib/logging/Logger.js';
import { currentRound } from "../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/stateMachine.mjs";
import Scoreboard from "../../../../../../__capabilities/gaming/browser/platform/ui/Scoreboard.jsx";
import { fetchSession } from "../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js";
import { sendJeopardyCommand } from "./jeopardyClient.js";
import { JEOPARDY_PACK, actionCue, phaseCues, consumePresentationEvents } from "./jeopardyCues.js";
import TitleCard from "../../../../../../__capabilities/gaming/browser/platform/ui/TitleCard.jsx";
import { useBuzzerSetup } from "./useBuzzerSetup.js";
import BuzzerStatus from "./ui/BuzzerStatus.jsx";
import HostLobby from "./ui/HostLobby.jsx";
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



export default function Jeopardy({ setId, seats = [], sessionId, config, gamingServices, onComplete, registerRemoteAction }) {
  const teams = seats;
  const logger = useMemo(() => getLogger().child({ component: 'jeopardy', sessionId }), [sessionId]);
  const teamIds = useMemo(() => teams.map((t) => t.id), [teams]);
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [state, setState] = useState(null);
  const errorRef = useRef(error);
  errorRef.current = error;
  const [selection, setSelection] = useState(null);
  const selectionTimer = useRef(null);
  const latestRevision = useRef(-1);
  const heardActionRevision = useRef(-1);
  const presentationCursor = useRef({ seq: null });
  const [completion, setCompletion] = useState(null);
  const scores = useMemo(() => state?.scores || {}, [state?.scores]);
  const audio = gamingServices?.audio || SILENT_AUDIO;
  const buzzers = gamingServices?.buzzers || NO_BUZZERS;
  const finishedRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingCommand = useRef(false);
  const actionRef = useRef(() => {});
  const mounted = useRef(true);
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(selectionTimer.current); }; }, []);
  useEffect(() => { latestRevision.current = -1; heardActionRevision.current = -1; presentationCursor.current = { seq: null }; stateRef.current = null; setSelection(null); return () => clearTimeout(selectionTimer.current); }, [sessionId]);

  useEffect(() => {
    return buzzers.subscribe((teamId) => {
      if (stateRef.current?.jeopardyFlowVersion !== 2) audio.play('buzz', { pack: JEOPARDY_PACK });
      actionRef.current({ type: 'BUZZ', teamId });
    });
  }, [audio, buzzers]);

  const acceptSession = useCallback((session) => {
    if (!mounted.current || activeSessionId.current !== sessionId) return;
    const revision = session.header?.revision;
    if (revision != null && revision < latestRevision.current) return;
    if (revision != null) latestRevision.current = revision;
    if (session.state.active?.clue.little_kids && !stateRef.current?.active) logger.info('jeopardy.assigned-clue', { teamId: session.state.answeringTeamId, roundIndex: session.state.roundIndex });
    const previous = stateRef.current;
    const next = session.state;
    const accepted = next.acceptedAction;
    const ordered = consumePresentationEvents(presentationCursor.current, next, {
      play: (cue, event) => audio.play(cue, { pack: JEOPARDY_PACK, context: { sessionId, revision: event.revision, teamId: event.teamId } }),
      gap: range => logger.warn('jeopardy.cue-gap', { sessionId, ...range }),
    });
    if (!ordered && accepted && accepted.revision > heardActionRevision.current) {
      heardActionRevision.current = accepted.revision;
      const cue = previous ? actionCue(accepted) : null;
      if (cue) audio.play(cue, { pack: JEOPARDY_PACK });
    }
    if (previous?.phase === 'board' && ['clue', 'wager'].includes(next.phase) && next.active && previous.roundIndex === next.roundIndex) {
      clearTimeout(selectionTimer.current);
      setSelection({ state: previous, selected: { cat: next.active.cat, row: next.active.row } });
      selectionTimer.current = setTimeout(() => { if (mounted.current) setSelection(null); }, 500);
    } else if (previous && (previous.roundIndex !== next.roundIndex || !['clue', 'judging', 'wager'].includes(next.phase))) {
      clearTimeout(selectionTimer.current); setSelection(null);
    }
    // Input can arrive after the HTTP acknowledgment and before React paints.
    stateRef.current = session.state;
    errorRef.current = null;
    setState(session.state); setSet(session.state.set); setCompletion(session.result || null); setError(null);
  }, [logger, sessionId, audio]);

  useBuzzerSetup({ sessionId, state, buzzers, acceptSession, audio, logger });

  // Load the coordinator projection, which includes the pinned content pack.
  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId)
      .then((session) => {
        if (cancelled) return;
        acceptSession(session);
      })
      .catch((err) => { if (cancelled) return; errorRef.current = err.message; setError(err.message); });
    return () => { cancelled = true; };
  }, [sessionId, setId, acceptSession]);

  // Hardware buzzers and timed trivia retain coordinator command dispatch.
  const applyAction = useCallback(async (action) => {
    if (!action || !stateRef.current || pendingCommand.current) return;
    pendingCommand.current = true;
    try { const result = await sendJeopardyCommand(sessionId, action); acceptSession(result); logger.info('jeopardy.command-result', { sessionId, type: action.type, teamId: action.teamId, revision: result.header?.revision, result: 'accepted' }); }
    catch (cause) { if (!mounted.current) return; logger.warn('jeopardy.command-failed', { type: action.type, phase: stateRef.current?.phase, error: cause.message }); errorRef.current = cause.message; setError(cause.message); }
    finally { pendingCommand.current = false; }
  }, [audio, sessionId, logger, acceptSession]);
  const recoverConnection = useCallback(async () => {
    if (pendingCommand.current) return;
    pendingCommand.current = true;
    logger.info('jeopardy.connection-retry', { sessionId });
    try {
      const session = await fetchSession(sessionId);
      presentationCursor.current = { seq: null };
      acceptSession(session);
      logger.info('jeopardy.connection-recovered', { phase: session.state.phase });
    } catch (cause) {
      if (!mounted.current) return;
      logger.warn('jeopardy.connection-retry-failed', { error: cause.message });
      errorRef.current = cause.message; setError(cause.message);
    } finally { pendingCommand.current = false; }
  }, [sessionId, logger, acceptSession]);
  actionRef.current = applyAction;

  // Buzzer arming window (hosted/self buzz races only).
  useEffect(() => {
    if (!set || !state) return;
    const round = currentRound(state);
    const buzzable = !selection && state.phase === 'clue' && !state.isDailyDouble && !state.active?.clue.little_kids && round.mode !== 'turns' && !state.revealed;
    if (buzzable) buzzers.arm(teamIds.filter((id) => !state.attempted.includes(id)));
    else buzzers.disarm();
  }, [state?.phase, state?.attempted, state?.revealed, state?.isDailyDouble, set, buzzers, teamIds, state, selection]);

  // A reconnect starts a fresh silent baseline rather than replaying offline cues.
  useEffect(() => wsService.onStatusChange(({ connected }) => {
    presentationCursor.current = { seq: null };
  }), [sessionId]);

  // Host updates reload the authoritative projection.
  useWebSocketSubscription('gaming', (msg) => {
    if (msg?.kind === 'session-updated' && msg.sessionId === sessionId) {
      fetchSession(sessionId).then((result) => { acceptSession(result); }).catch((cause) => { if (!mounted.current) return; errorRef.current = cause.message; setError(cause.message); });
    }
  }, [applyAction, sessionId, acceptSession]);

  // Finish
  useEffect(() => {
    if (state?.phase === 'done' && completion && !finishedRef.current) {
      finishedRef.current = true;
      if (state.jeopardyFlowVersion !== 2) audio.play('win', { pack: JEOPARDY_PACK });
      onComplete?.(completion);
    }
  }, [state?.phase, completion, audio, onComplete]);

  // Phase music (theme on the round title card, think music under Final) and
  // phase stings (Daily Double). Music stops when the phase moves on.
  useEffect(() => {
    if (!state?.phase) return undefined;
    const { music, sting } = phaseCues(state.phase);
    if (sting && state.jeopardyFlowVersion !== 2) audio.play(sting, { pack: JEOPARDY_PACK });

    if (!music) return undefined;
    audio.play(music, { pack: JEOPARDY_PACK, channel: 'music', loop: music === 'theme', volume: music === 'theme' ? 0.5 : 1 });
    return () => audio.stopChannel('music');
  }, [state?.phase, audio]);

  if (error) return <div className="party-games__error" role="alert">
    <strong>Game connection interrupted</strong>
    <span>{error}</span>
    <GameButton tone="primary" autoFocus onClick={recoverConnection}>Retry connection</GameButton>
  </div>;
  if (!set || !state) return <TitleCard title="Loading…" />;

  const round = currentRound(state);
  const { phase } = state;
  const lockedTeam = teams.find((t) => t.id === state.answeringTeamId) || null;
  const timerSeconds = round?.timer_seconds ?? config?.defaults?.timer_seconds ?? 12;

  return (
    <div className="jeopardy" data-phase={phase}>
      {phase !== 'round-intro' && !phase.startsWith('final-') && <ShowHeader eyebrow={round?.name} title={set.title} status={phase === 'board' ? `${teams.find(team => team.id === state.turnTeamId)?.name || 'Next team'} chooses — Round ${state.roundIndex + 1}` : state.active ? round.categories[state.active.cat]?.name : null} />}
      {phase === 'round-intro' && (state.roundIndex === 0 && Object.keys(state.used || {}).length === 0
        ? <HostLobby sessionId={sessionId} title={set.title} state={state} teams={teams} />
        : <div className="jp-final"><TitleCard title={round.name} subtitle={`${set.title} — round ${state.roundIndex + 1}`} /><BuzzerStatus state={state} teams={teams} /><p>Waiting for the host to open the board.</p></div>)}
      {phase === 'round-decision' && <div className="jp-final"><TitleCard title={`Round ${state.roundIndex + 1} complete`} subtitle="Choose on your phone: continue to the next round or finish the game." /></div>}
      {(phase === 'board' || selection) && <>
        <div className="jp-choose" role="status" style={{ '--team-color': teams.find(t => t.id === (selection?.state || state).turnTeamId)?.color }}>{teams.find(t => t.id === (selection?.state || state).turnTeamId)?.name || 'Next team'} — choose the next question</div>
        <Board round={round} used={(selection?.state || state).used} roundIndex={state.roundIndex} cursor={state.cursor} teams={teams} selected={selection?.selected} interactive={false} />
      </>}
      {!selection && phase === 'wager' && <div className="jp-final"><TitleCard title="Daily Double" subtitle={`${teams.find(t => t.id === state.answeringTeamId)?.name || 'Team'} is choosing a wager`} /><p>Waiting for the host to lock the wager.</p></div>}
      {!selection && (phase === 'clue' || phase === 'judging' || phase === 'answer-review') && (
        <ClueScreen
          key={`${state.roundIndex}:${state.active?.cat}:${state.active?.row}:${state.attempted.length}`}
          state={state}
          timerSeconds={timerSeconds}
          onTimeout={() => applyAction({ type: 'TIMEOUT' })}
          lockedTeam={lockedTeam}
        />
      )}
      {['final-category', 'final-wager', 'final-clue', 'final-judging'].includes(phase) && (
        <FinalRound state={state} teams={teams} />
      )}
      {phase !== 'round-intro' && <Scoreboard teams={teams} scores={scores} lockedTeamId={state.answeringTeamId} activeTeamId={state.turnTeamId} />}
    </div>
  );
}
