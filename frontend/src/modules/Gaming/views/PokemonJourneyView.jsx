import { useEffect, useRef } from 'react';
import './PokemonJourneyView.scss';
import { hitClass, pokemonAssetUrl, SKILL_LABELS } from './pokemonJourneyModel.js';
import { playJourneySfx } from './journeySfx.js';

function HealthBar({ name, value, max }) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="journey-health" style={{ '--health': `${percent}%` }}>
      <span><b>{name}</b><em>{value} / {max} HP</em></span>
      <i aria-hidden="true"><u /></i>
    </div>
  );
}

function PokemonFigure({ subject, side, state }) {
  return (
    <article className={`journey-figure journey-figure--${side} journey-figure--${subject.type}`}>
      <span className="journey-figure__label">{side === 'partner' ? 'Your partner' : 'Opponent'} · #{subject.dex}</span>
      <div className="journey-figure__art">
        <span className="journey-figure__halo" aria-hidden="true" />
        <img src={pokemonAssetUrl(subject.asset)} alt={subject.name} draggable="false" />
      </div>
      <HealthBar name={subject.name} value={state.health} max={state.max_health} />
    </article>
  );
}

function RivalCard({ leaderboard, score = 0 }) {
  const rival = leaderboard?.rival;
  if (!rival) {
    return <div className="journey-rival"><small>Household challenge</small><strong>Set the first score to beat.</strong></div>;
  }
  const gap = Math.max(0, rival.score - score);
  return (
    <div className="journey-rival">
      <small>Next rival</small>
      <strong>{rival.display_name} · {rival.score.toLocaleString()}</strong>
      <span>{gap > 0 ? `${gap.toLocaleString()} points ahead` : 'You are ahead—finish the journey!'}</span>
    </div>
  );
}

function JourneyPath({ opponents, state }) {
  return (
    <ol className="journey-path" aria-label="Journey progress">
      {opponents.map((opponent, index) => {
        const done = state.completed_encounters.includes(opponent.id);
        const active = index === state.current_encounter && state.status === 'active';
        return (
          <li key={opponent.id} className={`${done ? 'is-done' : ''}${active ? ' is-active' : ''}`}>
            <span>{done ? '✓' : index + 1}</span><b>{opponent.name}</b>
          </li>
        );
      })}
    </ol>
  );
}

function HitFeedback({ result }) {
  if (!result || result.resolving) return null;
  const category = hitClass(result.hitResult);
  const headline = category === 'direct' ? 'Direct hit!' : category === 'partial' ? 'Partial hit' : 'Miss';
  const showDetail = result.hitFeedback
    && result.hitFeedback.replace(/[^a-z]/gi, '').toLowerCase() !== headline.replace(/[^a-z]/gi, '').toLowerCase();
  return (
    <div className={`journey-hit journey-hit--${category}`} role="status">
      <strong>{headline}</strong>
      {showDetail && <span>{result.hitFeedback}</span>}
      <b>{result.damage} damage</b>
      {result.block > 0 && <em>+{result.block} shield</em>}
      {result.focus > 0 && <em>+{result.focus} next-move power</em>}
    </div>
  );
}

function MoveButton({ move, instance, legal, locked, onChoose }) {
  return (
    <button
      type="button"
      className={`journey-move journey-move--${move.challenge.kind}`}
      disabled={!legal}
      onClick={() => onChoose(instance.instance_id)}
      data-move-id={instance.definition_id}
      data-skill-kind={move.challenge.kind}
      data-damage={move.damage || 0}
    >
      <span className="journey-move__kind">{SKILL_LABELS[move.challenge.kind]}</span>
      <strong>{move.title}</strong>
      <span>{move.practice_label}</span>
      <small>{locked ? 'Defeat Pidgey to unlock' : move.signature ? 'Signature move' : move.description}</small>
      <i aria-hidden="true">{locked ? '🔒' : move.type === 'guard' ? '◈' : move.type === 'focus' ? '✦' : '➜'}</i>
    </button>
  );
}

function PracticePanel({ providerRuntime, move, partner, onAbort }) {
  const panelRef = useRef(null);
  const ChallengeSurface = providerRuntime?.Surface || null;
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  return (
    <section className="journey-practice" role="dialog" aria-modal="true" aria-label={`${move.title} piano challenge`}>
      <div className="journey-practice__panel" tabIndex={-1} ref={panelRef}>
        <header>
          <span>{partner.name} used <b>{move.title}</b></span>
          <strong>{SKILL_LABELS[move.challenge.kind]} power this move</strong>
          <small>Accuracy decides direct hit, partial hit, or miss.</small>
        </header>
        <div className="journey-practice__surface">
          {ChallengeSurface ? <ChallengeSurface /> : <div className="challenge-loading">Preparing your next exercise…</div>}
        </div>
        <button type="button" onClick={onAbort}>Stop attempt</button>
      </div>
    </section>
  );
}

function Checkpoint({ state, enemy, leaderboard, onContinue }) {
  const nextName = state.current_encounter < 2 ? ['Meowth', 'Snorlax'][state.current_encounter] : null;
  return (
    <section className="journey-intermission">
      <span className="journey-badge" aria-hidden="true">★</span>
      <small>Checkpoint cleared</small>
      <h2>{enemy.name} badge earned!</h2>
      <p>Your piano attempts are saved. Take a breath, then face {nextName}.</p>
      <RivalCard leaderboard={leaderboard} score={state.score} />
      <button type="button" onClick={onContinue}>Continue to {nextName}</button>
    </section>
  );
}

function Defeated({ enemy, attempts, onRetry }) {
  return (
    <section className="journey-intermission journey-intermission--defeated">
      <span className="journey-badge" aria-hidden="true">↻</span>
      <small>Checkpoint held</small>
      <h2>{enemy.name} won that round</h2>
      <p>Your {attempts} practice attempts still count. Retry this opponent with a fresh HP bar.</p>
      <button type="button" onClick={onRetry}>Retry {enemy.name}</button>
    </section>
  );
}

function JourneyComplete({ state, partner, leaderboard, onRestart, onChangePartner }) {
  const summary = state.journey_summary;
  return (
    <section className="journey-complete">
      <span className="journey-trophy" aria-hidden="true">🏆</span>
      <small>Three badges earned</small>
      <h2>Journey complete!</h2>
      <strong>{summary.score.toLocaleString()}</strong>
      <span>{summary.qualified ? 'Ranked score' : `${summary.completed_performances}/6 performances · practice saved, score unranked`}</span>
      <div className="journey-score-breakdown">
        <span><b>{Math.round(summary.breakdown.mean_challenge_score * 100)}%</b>accuracy</span>
        <span><b>{Math.round(summary.breakdown.first_pass_rate * 100)}%</b>first pass</span>
        <span><b>{Math.round(summary.breakdown.skill_family_breadth * 4)}/4</b>skills</span>
      </div>
      <RivalCard leaderboard={leaderboard} score={summary.score} />
      <div className="journey-complete__actions">
        <button type="button" onClick={() => onRestart(partner.id)}>Replay with {partner.name}</button>
        <button type="button" className="is-secondary" onClick={onChangePartner}>Change partner</button>
      </div>
    </section>
  );
}

export function PokemonJourneyView({
  session,
  providerRuntime,
  combatResult,
  error,
  leaderboard,
  onChoose,
  onContinue,
  onRetry,
  onRestart,
  onChangePartner,
  onAbort,
  onClose,
}) {
  const { state, definition, interaction } = session;
  const partner = definition.journey.partners.find((candidate) => candidate.id === state.partner_id);
  const enemy = definition.journey.opponents[state.current_encounter];
  const legalIds = new Set((interaction?.legal_commands || [])
    .filter((command) => command.type === 'choose_action')
    .map((command) => command.payload.card_instance_id));
  const pendingMove = state.pending_action ? definition.cards[state.pending_action.card_definition_id] : null;

  useEffect(() => {
    if (combatResult && !combatResult.resolving) playJourneySfx(hitClass(combatResult.hitResult));
  }, [combatResult]);
  useEffect(() => {
    if (state.phase === 'checkpoint') playJourneySfx('badge');
    if (state.phase === 'defeated') playJourneySfx('defeat');
  }, [state.phase]);

  return (
    <main
      className={`gaming-shell pokemon-journey journey-battle journey-battle--${state.phase}`}
      data-game-id={definition.game_id}
      data-battle-status={state.status}
      data-journey-phase={state.phase}
      data-encounter={enemy.id}
      data-partner={partner.id}
      data-turn={state.turn}
      data-player-health={state.player.health}
      data-enemy-health={state.enemy.health}
      data-score={state.score}
    >
      <header className="journey-topbar">
        <div><small>Piano League</small><h1>Scale Stadium</h1></div>
        <JourneyPath opponents={definition.journey.opponents} state={state} />
        <div className="journey-live-score"><small>Run score</small><strong>{state.score.toLocaleString()}</strong></div>
        {onClose && <button type="button" className="journey-close" onClick={onClose} aria-label="Close game">×</button>}
      </header>

      <section className="journey-arena">
        <PokemonFigure subject={partner} side="partner" state={state.player} />
        <div className="journey-arena__center">
          {state.phase === 'battle' && (
            <>
              <div className={`journey-intent journey-intent--${state.enemy.intent.kind}`}>
                <small>{enemy.name} is preparing</small>
                <strong>{state.enemy.intent.title}</strong>
                <span>{state.enemy.intent.kind === 'attack'
                  ? `${state.enemy.intent.amount + state.enemy.strength} damage`
                  : state.enemy.intent.kind === 'defend' ? `${state.enemy.intent.amount} shield` : `+${state.enemy.intent.amount} power`}</span>
              </div>
              <HitFeedback result={combatResult} />
              {!combatResult && <div className="journey-coach"><strong>Choose a piano move</strong><span>Play accurately. Types do not change your score.</span></div>}
              {error && <div className="journey-error">Recovered safely: {error.message}</div>}
            </>
          )}
          {state.phase === 'checkpoint' && <Checkpoint state={state} enemy={enemy} leaderboard={leaderboard} onContinue={onContinue} />}
          {state.phase === 'defeated' && <Defeated enemy={enemy} attempts={state.practice_attempts.length} onRetry={onRetry} />}
          {state.phase === 'complete' && (
            <JourneyComplete
              state={state}
              partner={partner}
              leaderboard={leaderboard}
              onRestart={onRestart}
              onChangePartner={onChangePartner}
            />
          )}
        </div>
        <PokemonFigure subject={enemy} side="opponent" state={state.enemy} />
      </section>

      {state.phase === 'battle' && (
        <section className="journey-moves" aria-label="Piano moves">
          {state.zones.hand.map((instance) => {
            const move = definition.cards[instance.definition_id];
            const locked = move.signature && state.completed_encounters.length === 0;
            return (
              <MoveButton
                key={instance.instance_id}
                move={move}
                instance={instance}
                locked={locked}
                legal={legalIds.has(instance.instance_id)}
                onChoose={onChoose}
              />
            );
          })}
        </section>
      )}

      {state.pending_action && (
        <PracticePanel providerRuntime={providerRuntime} move={pendingMove} partner={partner} onAbort={onAbort} />
      )}
    </main>
  );
}

export default PokemonJourneyView;
