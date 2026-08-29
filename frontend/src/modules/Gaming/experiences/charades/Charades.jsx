import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '../../platform/api/sessionClient.js';
import Scoreboard from '../../platform/ui/Scoreboard.jsx';
import SegmentedSecretText from '../../platform/ui/SegmentedSecretText.jsx';
import TimerRing from '../../platform/ui/TimerRing.jsx';
import TitleCard from '../../platform/ui/TitleCard.jsx';
import { useCountdown } from '../../platform/ui/useCountdown.js';
import './Charades.scss';

function CharadesTimer({ deadline, durationMs, onExpire }) {
  const seconds = deadline ? Math.max(0, (deadline - Date.now()) / 1000) : durationMs / 1000;
  const countdown = useCountdown({ seconds, running: true, onExpire });
  return <div className="charades__timer"><TimerRing progress={countdown.progress} /><strong>{Math.ceil(countdown.remaining)}</strong></div>;
}

export default function Charades({ teams, sessionId, onFinished }) {
  const [state, setState] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [error, setError] = useState(null);
  const command = useCallback(async (value, options) => {
    try {
      const result = await sendRuleCommand(sessionId, value, options);
      setState(result.state); setError(null); return result;
    } catch (cause) {
      setError(cause.message); return null;
    }
  }, [sessionId]);

  const refresh = useCallback(() => fetchSession(sessionId).then((result) => {
    setState(result.state); setDefinition(result.definition); setError(null);
  }).catch((cause) => setError(cause.message)), [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);
  useWebSocketSubscription('gaming', (message) => {
    if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh();
  }, [refresh, sessionId]);
  useEffect(() => {
    if (state?.phase === 'complete') onFinished?.(state.scores || {});
  }, [state?.phase, state?.scores, onFinished]);

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
      <header className="charades__header">
        <span>Round {state.round} of {definition.rounds}</span>
        <h1>Charades</h1>
        <span>{performerName}</span>
      </header>

      {state.phase === 'performer-ready' && (
        <section className="charades__center">
          <TitleCard title={`${performerName}, take the stage`} subtitle="Your secret clue is ready." />
          <button type="button" autoFocus onClick={() => command({ type: 'performer.ready' })}>Show my clue</button>
        </section>
      )}

      {state.phase === 'challenge-ready' && (
        <section className="charades__center">
          <p className="charades__eyebrow">Secret clue</p>
          <SegmentedSecretText text={prompt} label="Charades clue" />
          <button type="button" autoFocus onClick={() => command({ type: 'challenge.start' })}>Start acting</button>
        </section>
      )}

      {state.phase === 'performing' && (
        <section className="charades__center charades__performing">
          <CharadesTimer deadline={state.deadline} durationMs={definition.timer_ms} onExpire={() => command({ type: 'timer.expire' })} />
          <SegmentedSecretText text={prompt} label="Charades clue" />
          <p className="charades__rule">Act it out — no talking, spelling, or pointing at objects.</p>
          <button type="button" onClick={() => command({ type: 'challenge.finish' })}>Stop timer</button>
        </section>
      )}

      {state.phase === 'adjudication' && (
        <section className="charades__center">
          <h2>Was it guessed?</h2>
          <div className="charades__actions">
            <button type="button" autoFocus onClick={() => command({ type: 'outcome.correct' })}>Guessed it</button>
            <button type="button" onClick={() => command({ type: 'outcome.incorrect' })}>Not guessed</button>
            <button type="button" onClick={() => command({ type: 'outcome.pass' })}>Pass</button>
          </div>
        </section>
      )}

      {state.phase === 'verification' && (
        <section className="charades__center"><h2>Waiting for opponent confirmation…</h2></section>
      )}

      {state.phase === 'challenge-complete' && (
        <section className="charades__center">
          <TitleCard title="Clue complete" subtitle="Pass the stage to the next performer." />
          <button type="button" autoFocus onClick={() => command({ type: 'challenge.next' })}>Next clue</button>
        </section>
      )}

      <Scoreboard teams={teams} scores={state.scores || {}} activeTeamId={state.performer_id} />
    </main>
  );
}
