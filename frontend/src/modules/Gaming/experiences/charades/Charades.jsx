import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
import Scoreboard from '@gaming-ui/Scoreboard.jsx';
import SegmentedSecretText from '@gaming-ui/SegmentedSecretText.jsx';
import Timer from '@gaming-ui/Timer.jsx';
import ImageDecoderDisplay from '@gaming-ui/ImageDecoderDisplay.jsx';
import FamilySelector from '@/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx';
import getLogger from '@/lib/logging/Logger.js';
import ShowHeader from '@gaming-ui/ShowHeader.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import InstructionCard from '@gaming-ui/InstructionCard.jsx';
import StageActions from '@gaming-ui/StageActions.jsx';
import OutcomeReveal from '@gaming-ui/OutcomeReveal.jsx';
import CompanionPanel from '@gaming-ui/CompanionPanel.jsx';
import TitleCard from '@gaming-ui/TitleCard.jsx';
import './Charades.scss';

export default function Charades({ seats = [], sessionId, onComplete, gamingServices }) {
  const teams = seats;
  const audio = gamingServices?.audio;
  const [state, setState] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [error, setError] = useState(null);
  const [completion, setCompletion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [musicError, setMusicError] = useState(null);
  const [musicAttempt, setMusicAttempt] = useState(0);
  const completedRef = React.useRef(false);
  const inFlight = React.useRef(false);
  const revision = React.useRef(-1);
  const failedCommand = React.useRef(null);
  const epoch = React.useRef(0);
  const logger = useMemo(() => getLogger().child({ component: 'charades', sessionId }), [sessionId]);
  const apply = useCallback((result) => {
    const nextRevision = result.header?.revision ?? 0;
    if (nextRevision < revision.current) return;
    revision.current = nextRevision;
    setState(result.state); if (result.definition) setDefinition(result.definition);
    setCompletion(result.result || null); setError(null);
  }, []);
  const command = useCallback(async (value, options) => {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); const currentEpoch = epoch.current;
    try {
      const result = await sendRuleCommand(sessionId, value, options);
      if (currentEpoch !== epoch.current) return null;
      apply(result); failedCommand.current = null;
      logger.info('charades.command', { command: value.type, phase: result.state?.phase, revision: result.header?.revision });
      if (result.state?.competition !== false) {
        if (value.type === 'outcome.correct') audio?.play('correct');
        else if (value.type === 'outcome.incorrect') audio?.play('wrong');
        else if (value.type === 'challenge.next') audio?.play('handoff');
        else if (value.type === 'challenge.start') audio?.play('ready');
      }
      return result;
    } catch (cause) {
      if (currentEpoch === epoch.current) { failedCommand.current = { value, options, revision: revision.current }; setError(cause.message); logger.warn('charades.command-failed', { command: value.type, error: cause.message }); }
      return null;
    } finally { if (currentEpoch === epoch.current) { inFlight.current = false; setBusy(false); } }
  }, [apply, audio, logger, sessionId]);
  const refresh = useCallback(async () => {
    const currentEpoch = epoch.current;
    try { const result = await fetchSession(sessionId); if (currentEpoch === epoch.current) { apply(result); return result; } }
    catch (cause) { if (currentEpoch === epoch.current) setError(cause.message); }
  }, [apply, sessionId]);
  const retry = async () => {
    const failed = failedCommand.current;
    const current = await refresh();
    if (failed && current?.header?.revision === failed.revision) await command(failed.value, failed.options);
  };
  useEffect(() => {
    epoch.current += 1; revision.current = -1; completedRef.current = false; inFlight.current = false;
    setState(null); setDefinition(null); refresh();
    return () => { epoch.current += 1; };
  }, [refresh]);
  useWebSocketSubscription('gaming', (message) => {
    if (message?.kind === 'session-updated' && message.sessionId === sessionId) refresh();
  }, [refresh, sessionId]);
  useEffect(() => {
    if (state?.phase === 'complete' && completion && !completedRef.current) {
      completedRef.current = true; if (state.competition !== false) audio?.play('win'); onComplete?.(completion);
    }
  }, [audio, completion, onComplete, state?.phase, state?.competition]);
  useEffect(() => {
    setMusicError(null);
    if (state?.phase !== 'performing' || !definition?.guessing_music) return;
    return gamingServices?.music?.start(definition.guessing_music, { onError: cause => setMusicError(cause?.message || 'Music could not start') });
  }, [state?.phase, state?.challenge_index, definition?.guessing_music?.source, definition?.guessing_music?.volume, gamingServices?.music, musicAttempt]);

  const performer = useMemo(
    () => teams.find((team) => team.id === state?.performer_id),
    [teams, state?.performer_id],
  );
  const performerName = performer?.name || state?.performer_id || 'Performer';
  const prompt = state?.challenge?.prompt || '';


  if (!state || !definition) return error ? <div className="party-games__error" role="alert">{error}<GameButton onClick={retry}>Retry</GameButton></div> : <TitleCard title="Charades" subtitle="Choosing a secret…" />;

  const casual = state.competition === false;
  const anotherClue = state.remaining_ms > 0 && (state.clue_index || 0) + 1 < (definition.clues_per_turn || 1);
  const finalTurn = !anotherClue && state.challenge_index === (state.turn_order?.length || 0) - 1;
  return (
    <main className="charades" data-phase={state.phase} data-casual={casual}>
      {error && <div role="alert" className="charades__notice">{error}<GameButton onClick={retry}>Retry</GameButton></div>}
      <ShowHeader eyebrow={`Round ${state.round} of ${definition.rounds}`} title="Charades" status={performerName} />

      {state.phase === 'performer-ready' && (
        <section className="charades__center">
          {casual ? <><p className="charades__eyebrow">Choosing the next performer</p><FamilySelector key={`${state.challenge_index}:${state.performer_id}`} members={seats} winner={state.performer_id} autoSpin embedded durationMs={2600} onComplete={() => command({ type: 'performer.ready' })} /><strong>{performerName}, get the red decoder card ready</strong></> : <InstructionCard eyebrow="Next performer" title={`${performerName}, take the stage`}><p>Get the red decoder card. Your secret stays concealed until you are ready.</p><footer><GameButton tone="primary" busy={busy} autoFocus onClick={() => command({ type: 'performer.ready' })}>Reveal with decoder</GameButton></footer></InstructionCard>}
        </section>
      )}

      {state.phase === 'challenge-ready' && (
        <section className="charades__center">
          <p className="charades__eyebrow">Secret clue</p>
          {state.clue_presentation === 'image' ? <ImageDecoderDisplay src={state.challenge?.decoder?.image} alt="Encoded image clue for the performer" /> : <SegmentedSecretText text={prompt} label="Charades clue" accessibleText="Encoded charades clue for the performer" />}
          <p className="charades__decoder-help">Performer only: view through the red decoder card.</p>
          <GameButton tone="primary" busy={busy} autoFocus onClick={() => command({ type: 'challenge.start' })}>{casual ? 'Go' : 'Start acting'}</GameButton>
        </section>
      )}

      {state.phase === 'performing' && (
        <section className="charades__center charades__performing">
          <Timer className="charades__timer" size="xl" format="seconds" deadline={state.deadline} durationMs={definition.timer_ms} onComplete={() => command({ type: 'timer.expire' })} />
          {musicError && <div className="charades__notice" role="status">{musicError}<GameButton onClick={() => setMusicAttempt(value => value + 1)}>Retry music</GameButton></div>}
          <div className="charades__spotlight" aria-label="The secret clue is concealed during play">Act!</div>
          <p className="charades__rule">Act it out — no talking, spelling, or pointing at objects.</p>
          <GameButton tone="primary" busy={busy} autoFocus onClick={() => command({ type: 'challenge.finish' })}>{casual ? 'Finish turn' : 'Stop timer'}</GameButton>
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
        <section className={`charades__center${casual && state.clue_presentation === 'image' ? ' charades__image-reveal' : ''}`}>
          <OutcomeReveal tone="success" eyebrow={casual ? "The clue was" : "Score committed"} title={casual ? prompt : "Clue complete"}>
            {casual && state.clue_presentation === 'image' && (
              <img className="charades__revealed-image" src={state.challenge?.decoder?.image} alt={prompt} />
            )}
            <p>{casual ? "Thanks for acting!" : "Pass the stage to the next performer."}</p>
            <GameButton tone="primary" busy={busy} autoFocus onClick={() => command({ type: 'challenge.next' })}>
              {casual ? (anotherClue ? 'Next clue' : finalTurn ? 'Finish game' : 'Next performer') : 'Next clue'}
            </GameButton>
          </OutcomeReveal>
        </section>
      )}

      {!casual && <Scoreboard teams={teams} scores={state.scores || {}} activeTeamId={state.performer_id} />}
    </main>
  );
}
