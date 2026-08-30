import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import Scoreboard from '@gaming-ui/Scoreboard.jsx';
import SegmentedSecretText from '@gaming-ui/SegmentedSecretText.jsx';
import TimerRing from '@gaming-ui/TimerRing.jsx';
import { useCountdown } from '@gaming-ui/useCountdown.js';
import ShowHeader from '@gaming-ui/ShowHeader.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import InstructionCard from '@gaming-ui/InstructionCard.jsx';
import StageActions from '@gaming-ui/StageActions.jsx';
import OutcomeReveal from '@gaming-ui/OutcomeReveal.jsx';
import CompanionPanel from '@gaming-ui/CompanionPanel.jsx';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import './Charades.scss';

function CharadesTimer({ deadline, durationMs, onExpire }) {
  const seconds = deadline ? Math.max(0, (deadline - Date.now()) / 1000) : durationMs / 1000;
  const countdown = useCountdown({ seconds, running: true, onExpire });
  return <div className="charades__timer"><TimerRing progress={countdown.progress} remaining={countdown.remaining} /><strong>{Math.ceil(countdown.remaining)}</strong></div>;
}

export default function Charades({ seats = [], sessionId, onComplete, gamingServices }) {
  const teams = seats;
  const audio = gamingServices?.audio;
  const [state, setState] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [error, setError] = useState(null);
  const [completion, setCompletion] = useState(null);
  const completedRef = React.useRef(false);
  const command = useCallback(async (value, options) => {
    try {
      const result = await sendRuleCommand(sessionId, value, options);
      setState(result.state); setCompletion(result.result || null); setError(null);
      if (value.type === 'outcome.correct') audio?.play('correct');
      else if (value.type === 'outcome.incorrect') audio?.play('wrong');
      else if (value.type === 'challenge.next') audio?.play('handoff');
      else if (value.type === 'challenge.start') audio?.play('ready');
      return result;
    } catch (cause) {
      setError(cause.message); return null;
    }
  }, [audio, sessionId]);

  const refresh = useCallback(() => fetchSession(sessionId).then((result) => {
    setState(result.state); setDefinition(result.definition); setCompletion(result.result || null); setError(null);
  }).catch((cause) => setError(cause.message)), [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);
  useWebSocketSubscription('gaming', (message) => {
    if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh();
  }, [refresh, sessionId]);
  useEffect(() => {
    if (state?.phase === 'complete' && completion && !completedRef.current) { completedRef.current = true; audio?.play('win'); onComplete?.(completion); }
  }, [audio, completion, onComplete, state?.phase]);

  const performer = useMemo(
    () => teams.find((team) => team.id === state?.performer_id),
    [teams, state?.performer_id],
  );
  const performerName = performer?.name || state?.performer_id || 'Performer';
  const prompt = state?.challenge?.prompt || '';

  if (error) return <div className="party-games__error">{error}</div>;
  if (!state || !definition) return <TitleCard title="Charades" subtitle="Choosing a secret…" />;

  return (
    <main className="charades" data-phase={state.phase}>
      <ShowHeader eyebrow={`Round ${state.round} of ${definition.rounds}`} title="Charades" status={performerName} />

      {state.phase === 'performer-ready' && (
        <section className="charades__center">
          <InstructionCard eyebrow="Next performer" title={`${performerName}, take the stage`}><p>Get the red decoder card. Your secret stays concealed until you are ready.</p><footer><GameButton tone="primary" autoFocus onClick={() => command({ type: 'performer.ready' })}>Reveal with decoder</GameButton></footer></InstructionCard>
        </section>
      )}

      {state.phase === 'challenge-ready' && (
        <section className="charades__center">
          <p className="charades__eyebrow">Secret clue</p>
          <SegmentedSecretText text={prompt} label="Charades clue" accessibleText="Encoded charades clue for the performer" />
          <p className="charades__decoder-help">Performer only: view through the red decoder card.</p>
          <GameButton tone="primary" autoFocus onClick={() => command({ type: 'challenge.start' })}>Start acting</GameButton>
        </section>
      )}

      {state.phase === 'performing' && (
        <section className="charades__center charades__performing">
          <CharadesTimer deadline={state.deadline} durationMs={definition.timer_ms} onExpire={() => command({ type: 'timer.expire' })} />
          <div className="charades__spotlight" aria-label="The secret clue is concealed during play">Act!</div>
          <p className="charades__rule">Act it out — no talking, spelling, or pointing at objects.</p>
          <GameButton tone="primary" onClick={() => command({ type: 'challenge.finish' })}>Stop timer</GameButton>
        </section>
      )}

      {state.phase === 'adjudication' && (
        <section className="charades__center">
          <InstructionCard eyebrow="The clue was" title={prompt}><p>Was it guessed before time ran out?</p><StageActions><GameButton tone="success" autoFocus onClick={() => command({ type: 'outcome.correct' })}>Guessed it</GameButton><GameButton tone="danger" onClick={() => command({ type: 'outcome.incorrect' })}>Not guessed</GameButton><GameButton tone="quiet" onClick={() => command({ type: 'outcome.pass' })}>Pass</GameButton></StageActions></InstructionCard>
        </section>
      )}

      {state.phase === 'verification' && (
        <section className="charades__center"><InstructionCard eyebrow="One quick check" title="Waiting for the verifier"><p>The assigned opponent must confirm the result from their phone.</p><CompanionPanel title="Verifier controller" url={`${window.location.origin}/party-games/verify/${sessionId}`} size={110} /></InstructionCard></section>
      )}

      {state.phase === 'challenge-complete' && (
        <section className="charades__center">
          <OutcomeReveal tone="success" eyebrow="Score committed" title="Clue complete"><p>Pass the stage to the next performer.</p><GameButton tone="primary" autoFocus onClick={() => command({ type: 'challenge.next' })}>Next clue</GameButton></OutcomeReveal>
        </section>
      )}

      <Scoreboard teams={teams} scores={state.scores || {}} activeTeamId={state.performer_id} />
    </main>
  );
}
