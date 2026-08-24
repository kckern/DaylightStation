import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchDrawingCheckpoint, fetchSession, saveDrawingCheckpoint, sendRuleCommand } from '../../environments/group-play/app/sessionClient.js';
import DrawingCanvas from '../../environments/group-play/surfaces/DrawingCanvas.jsx';
import { DecoderText, HighContrastMask } from '../../environments/group-play/presenters/DecoderPresenter.jsx';
import Scoreboard from '../../environments/group-play/presenters/Scoreboard.jsx';
import TimerRing from '../../environments/group-play/ui/TimerRing.jsx';
import TitleCard from '../../environments/group-play/ui/TitleCard.jsx';
import { useCountdown } from '../../environments/group-play/ui/useCountdown.js';
import './ActivityParty.scss';

function ChallengeTimer({ running, onExpire, deadline, durationMs = 60_000 }) {
  const seconds = deadline ? Math.max(0, (deadline - Date.now()) / 1000) : durationMs / 1000;
  const countdown = useCountdown({ seconds, running, onExpire });
  return <div className="activity-party__timer"><TimerRing progress={countdown.progress} /><strong>{Math.ceil(countdown.remaining)}</strong></div>;
}

export default function ActivityParty({ teams, sessionId, onFinished }) {
  const [state, setState] = useState(null); const [definition, setDefinition] = useState(null); const [error, setError] = useState(null);
  const [drawingCheckpoint, setDrawingCheckpoint] = useState([]);
  const checkpointQueue = useRef(Promise.resolve());
  const command = useCallback(async (value, options) => {
    try { const result = await sendRuleCommand(sessionId, value, options); setState(result.state); setError(null); return result; }
    catch (cause) { setError(cause.message); return null; }
  }, [sessionId]);
  useEffect(() => { let live = true; fetchSession(sessionId).then((result) => { if (live) { setState(result.state); setDefinition(result.definition); } }).catch((cause) => setError(cause.message)); return () => { live = false; }; }, [sessionId]);
  useEffect(() => { let live = true; fetchDrawingCheckpoint(sessionId).then((result) => { if (live) setDrawingCheckpoint(result.strokes || []); }).catch((cause) => setError(cause.message)); return () => { live = false; }; }, [sessionId]);
  useEffect(() => {
    if (state?.phase === 'challenge-complete' || state?.phase === 'complete') setDrawingCheckpoint([]);
  }, [state?.challenge_index, state?.phase]);
  useWebSocketSubscription('gaming', (message) => { if (message?.kind === 'session-updated' && message.sessionId === sessionId) fetchSession(sessionId).then((result) => setState(result.state)).catch((cause) => setError(cause.message)); }, [sessionId]);
  useEffect(() => { if (state?.phase === 'complete') onFinished?.(state.scores || {}); }, [state?.phase, state?.scores, onFinished]);
  const checkpointDrawing = useCallback((strokes) => {
    setDrawingCheckpoint(strokes);
    checkpointQueue.current = checkpointQueue.current.catch(() => {}).then(() => saveDrawingCheckpoint(sessionId, strokes));
    checkpointQueue.current.catch((cause) => setError(cause.message));
  }, [sessionId]);
  const performer = useMemo(() => teams.find((team) => team.id === state?.performer_id), [teams, state?.performer_id]);
  if (error) return <div className="group-play__error">{error}</div>;
  if (!state || !definition) return <TitleCard title="Activity Party" subtitle="Loading…" />;
  const challenge = state.challenge;
  return <div className="activity-party" data-phase={state.phase}>
    <header><span>Round {state.round} of {definition.rounds}</span><h1>{challenge?.activity === 'draw' ? 'Draw' : 'Charades'}</h1><span>{performer?.name || state.performer_id}</span></header>
    {state.phase === 'performer-ready' && <section className="activity-party__ready"><TitleCard title={`${performer?.name || 'Performer'}, are you ready?`} subtitle="The timer will not start until you confirm." /><button autoFocus type="button" onClick={() => command({ type: 'performer.ready' })}>I’m ready</button></section>}
    {state.phase === 'challenge-ready' && <section className="activity-party__prompt"><h2>{challenge.prompt}</h2><DecoderText>{challenge.decoder?.text || challenge.prompt}</DecoderText><button autoFocus type="button" onClick={() => command({ type: 'challenge.start' })}>Start timer</button></section>}
    {state.phase === 'performing' && <section className="activity-party__performing">
      <ChallengeTimer running deadline={state.deadline} onExpire={() => command({ type: 'timer.expire' })} durationMs={definition.timer_ms} />
      <div className="activity-party__aid"><DecoderText>{challenge.decoder?.text || challenge.prompt}</DecoderText>{challenge.decoder?.image && <HighContrastMask src={challenge.decoder.image} alt="Decoder clue" />}</div>
      {challenge.activity === 'draw'
        ? <DrawingCanvas
          ink={challenge.drawing?.ink}
          width={challenge.drawing?.width}
          cursor={challenge.drawing?.cursor}
          initialStrokes={drawingCheckpoint}
          onCheckpoint={checkpointDrawing}
          onFinish={() => command({ type: 'challenge.finish' })}
        />
        : <div className="activity-party__charades"><h2>Act it out—no words.</h2><button type="button" onClick={() => command({ type: 'challenge.finish' })}>Finish</button></div>}
    </section>}
    {state.phase === 'adjudication' && <section className="activity-party__judge"><h2>How did they do?</h2><button onClick={() => command({ type: 'outcome.correct' })}>Correct</button><button onClick={() => command({ type: 'outcome.incorrect' })}>Incorrect</button><button onClick={() => command({ type: 'outcome.pass' })}>Pass</button><button onClick={() => command({ type: 'score.adjust', subject_id: state.performer_id, delta: 1 })}>+1 adjustment</button></section>}
    {state.phase === 'verification' && <section className="activity-party__verify"><h2>Opponent confirmation required</h2><p>The configured verifier must confirm from their authenticated controller.</p><img src={`/api/v1/qrcode?data=${encodeURIComponent(`${window.location.origin}/group-play/verify/${sessionId}`)}&size=180`} width="180" height="180" alt="Open verifier controller" /></section>}
    {state.phase === 'challenge-complete' && <section className="activity-party__complete"><h2>Challenge complete</h2><button autoFocus onClick={() => command({ type: 'challenge.next' })}>Next performer</button></section>}
    <Scoreboard teams={teams} scores={state.scores || {}} activeTeamId={state.performer_id} />
  </div>;
}
