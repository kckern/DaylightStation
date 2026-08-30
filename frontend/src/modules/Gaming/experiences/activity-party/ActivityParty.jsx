import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchDrawingCheckpoint, fetchSession, saveDrawingCheckpoint, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import DrawingCanvas from './presentation/DrawingCanvas.jsx';
import { DecoderText, HighContrastMask } from './presentation/DecoderPresenter.jsx';
import Scoreboard from '@gaming-ui/Scoreboard.jsx';
import TimerRing from '@gaming-ui/TimerRing.jsx';
import { useCountdown } from '@gaming-ui/useCountdown.js';
import ShowHeader from '@gaming-ui/ShowHeader.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import InstructionCard from '@gaming-ui/InstructionCard.jsx';
import StageActions from '@gaming-ui/StageActions.jsx';
import OutcomeReveal from '@gaming-ui/OutcomeReveal.jsx';
import CompanionPanel from '@gaming-ui/CompanionPanel.jsx';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import './ActivityParty.scss';

function ChallengeTimer({ running, onExpire, deadline, durationMs = 60_000 }) {
  const seconds = deadline ? Math.max(0, (deadline - Date.now()) / 1000) : durationMs / 1000;
  const countdown = useCountdown({ seconds, running, onExpire });
  return <div className="activity-party__timer"><TimerRing progress={countdown.progress} remaining={countdown.remaining} /><strong>{Math.ceil(countdown.remaining)}</strong></div>;
}

export default function ActivityParty({ seats = [], sessionId, onComplete, gamingServices }) {
  const teams = seats;
  const audio = gamingServices?.audio;
  const [state, setState] = useState(null); const [definition, setDefinition] = useState(null); const [error, setError] = useState(null);
  const [completion, setCompletion] = useState(null);
  const completedRef = useRef(false);
  const [drawingCheckpoint, setDrawingCheckpoint] = useState([]);
  const checkpointQueue = useRef(Promise.resolve());
  const command = useCallback(async (value, options) => {
    try {
      const result = await sendRuleCommand(sessionId, value, options); setState(result.state); setCompletion(result.result || null); setError(null);
      if (value.type === 'outcome.correct') audio?.play('correct');
      else if (value.type === 'outcome.incorrect') audio?.play('wrong');
      else if (value.type === 'challenge.next') audio?.play('handoff');
      else if (value.type === 'challenge.start') audio?.play('ready');
      return result;
    }
    catch (cause) { setError(cause.message); return null; }
  }, [audio, sessionId]);
  useEffect(() => { let live = true; fetchSession(sessionId).then((result) => { if (live) { setState(result.state); setDefinition(result.definition); setCompletion(result.result || null); } }).catch((cause) => setError(cause.message)); return () => { live = false; }; }, [sessionId]);
  useEffect(() => { let live = true; fetchDrawingCheckpoint(sessionId).then((result) => { if (live) setDrawingCheckpoint(result.strokes || []); }).catch((cause) => setError(cause.message)); return () => { live = false; }; }, [sessionId]);
  useEffect(() => {
    if (state?.phase === 'challenge-complete' || state?.phase === 'complete') setDrawingCheckpoint([]);
  }, [state?.challenge_index, state?.phase]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) fetchSession(sessionId).then((result) => { setState(result.state); setCompletion(result.result || null); }).catch((cause) => setError(cause.message)); }, [sessionId]);
  useEffect(() => { if (state?.phase === 'complete' && completion && !completedRef.current) { completedRef.current = true; audio?.play('win'); onComplete?.(completion); } }, [audio, completion, onComplete, state?.phase]);
  const checkpointDrawing = useCallback((strokes) => {
    setDrawingCheckpoint(strokes);
    checkpointQueue.current = checkpointQueue.current.catch(() => {}).then(() => saveDrawingCheckpoint(sessionId, strokes));
    checkpointQueue.current.catch((cause) => setError(cause.message));
  }, [sessionId]);
  const performer = useMemo(() => teams.find((team) => team.id === state?.performer_id), [teams, state?.performer_id]);
  if (error) return <div className="party-games__error">{error}</div>;
  if (!state || !definition) return <TitleCard title="Activity Party" subtitle="Loading…" />;
  const challenge = state.challenge;
  return <div className="activity-party" data-phase={state.phase}>
    <ShowHeader eyebrow={`Round ${state.round} of ${definition.rounds}`} title={challenge?.activity === 'draw' ? 'Draw' : 'Charades'} status={performer?.name || state.performer_id} />
    {state.phase === 'performer-ready' && <section className="activity-party__ready"><InstructionCard eyebrow="Next performer" title={`${performer?.name || 'Performer'}, take the stage`}><p>Your clue stays concealed until everyone is ready.</p><footer><GameButton tone="primary" autoFocus onClick={() => command({ type: 'performer.ready' })}>I’m ready</GameButton></footer></InstructionCard></section>}
    {state.phase === 'challenge-ready' && <section className="activity-party__prompt"><InstructionCard eyebrow="Secret clue" title="Use the red decoder card"><p>Only the performer should look through the decoder. The timer starts when the room is ready.</p><DecoderText>{challenge.decoder?.text || challenge.prompt}</DecoderText><footer><GameButton tone="primary" autoFocus onClick={() => command({ type: 'challenge.start' })}>Start timer</GameButton></footer></InstructionCard></section>}
    {state.phase === 'performing' && <section className="activity-party__performing">
      <ChallengeTimer running deadline={state.deadline} onExpire={() => command({ type: 'timer.expire' })} durationMs={definition.timer_ms} />
      <div className="activity-party__aid" aria-label="The secret clue is locked while the round is active"><span>Secret locked</span>{challenge.decoder?.image && <HighContrastMask src={challenge.decoder.image} alt="Decoder clue" />}</div>
      {challenge.activity === 'draw'
        ? <DrawingCanvas
          ink={challenge.drawing?.ink}
          width={challenge.drawing?.width}
          cursor={challenge.drawing?.cursor}
          initialStrokes={drawingCheckpoint}
          onCheckpoint={checkpointDrawing}
          onFinish={() => command({ type: 'challenge.finish' })}
        />
        : <div className="activity-party__charades"><h2>Act it out—no words.</h2><GameButton tone="primary" onClick={() => command({ type: 'challenge.finish' })}>Finish performance</GameButton></div>}
    </section>}
    {state.phase === 'adjudication' && <section className="activity-party__judge"><InstructionCard eyebrow="Judge the round" title="Was the challenge completed?"><p>Choose the result that everyone in the room saw.</p><StageActions><GameButton tone="success" autoFocus onClick={() => command({ type: 'outcome.correct' })}>Completed</GameButton><GameButton tone="danger" onClick={() => command({ type: 'outcome.incorrect' })}>Not completed</GameButton><GameButton tone="quiet" onClick={() => command({ type: 'outcome.pass' })}>Pass</GameButton></StageActions><footer><GameButton tone="quiet" onClick={() => command({ type: 'score.adjust', subject_id: state.performer_id, delta: 1 })}>Add a bonus point</GameButton></footer></InstructionCard></section>}
    {state.phase === 'verification' && <section className="activity-party__verify"><InstructionCard eyebrow="One quick check" title="Waiting for the verifier"><p>The assigned opponent must confirm this round from their phone.</p><CompanionPanel title="Verifier controller" url={`${window.location.origin}/party-games/verify/${sessionId}`} size={110} /></InstructionCard></section>}
    {state.phase === 'challenge-complete' && <section className="activity-party__complete"><OutcomeReveal tone="success" eyebrow="Score committed" title="Round complete"><p>Pass the stage to the next performer.</p><GameButton tone="primary" autoFocus onClick={() => command({ type: 'challenge.next' })}>Next performer</GameButton></OutcomeReveal></section>}
    <Scoreboard teams={teams} scores={state.scores || {}} activeTeamId={state.performer_id} />
  </div>;
}
