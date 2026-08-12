import { useEffect, useRef, useState } from 'react';
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

export function pokemonFigureFlipped(side, assetFacing) {
  return (side === 'partner' && assetFacing === 'left')
    || (side === 'opponent' && assetFacing === 'right');
}

function PokemonFigure({ subject, side, state }) {
  const flipped = pokemonFigureFlipped(side, subject.asset_facing);
  return (
    <article
      className={`journey-figure journey-figure--${side} journey-figure--${subject.type}${flipped ? ' is-flipped' : ''}`}
      data-asset-facing={subject.asset_facing}
    >
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
  const nodes = Array.from({ length: 5 }, (_, index) => opponents[index] || null);
  return (
    <ol className="journey-path" aria-label="Journey progress">
      {nodes.map((opponent, index) => {
        const done = opponent ? state.completed_encounters.includes(opponent.id) : false;
        const active = state.campaign_stage === 'route' && index === state.current_encounter && state.status === 'active';
        return (
          <li key={opponent?.id || `route-${index}`} className={`${done ? 'is-done' : ''}${active ? ' is-active' : ''}`}>
            <span>{done ? '✓' : index + 1}</span><b>{done || active ? opponent?.name || 'Gym route' : '???'}</b>
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

function MoveButton({ move, instance, legal, locked, onChoose, shortcut }) {
  const effects = [
    move.damage ? `${move.damage} ATK` : null,
    move.block ? `+${move.block} SHIELD` : null,
    move.focus ? `+${move.focus} NEXT` : null,
  ].filter(Boolean);
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
      <span className="journey-move__kind">{SKILL_LABELS[move.challenge.kind]} · {shortcut}</span>
      <strong>{move.title}</strong>
      <span className="journey-move__effects">{effects.map((effect) => <b key={effect}>{effect}</b>)}</span>
      <small>{locked ? 'Locked' : move.signature ? 'Signature' : 'Ready'}</small>
      <i aria-hidden="true">{locked ? '🔒' : move.type === 'guard' ? '◈' : move.type === 'focus' ? '✦' : '➜'}</i>
    </button>
  );
}

function PracticePanel({ providerRuntime, move, partner, onAbort, onSaveExit }) {
  const panelRef = useRef(null);
  const ChallengeSurface = providerRuntime?.Surface || null;
  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onAbort();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onAbort]);
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
        <footer><button type="button" onClick={onAbort}>Stop attempt</button><button type="button" onClick={onSaveExit}>Save &amp; Exit</button></footer>
      </div>
    </section>
  );
}

function Checkpoint({ state, enemy, progress, onContinue }) {
  return (
    <section className="journey-intermission journey-research-report">
      <span className="journey-badge" aria-hidden="true">✓</span>
      <small>Research report</small>
      <h2>{enemy.name} defeated</h2>
      <div className="journey-report-grid"><span><b>+10</b> Pokédex XP</span><span><b>+1</b> Partner win</span><span><b>{state.practice_attempts.at(-1) ? `${Math.round(state.practice_attempts.at(-1).score * 100)}%` : '—'}</b> Skill score</span><span><b>{progress?.daily?.completed ? '✓' : 'In progress'}</b> Daily research</span><span><b>{progress?.weekly?.stamp_count || 0}/4</b> Weekly stamps</span><span><b>+0–2</b> Coins</span></div>
      <button type="button" onClick={onContinue}>Continue</button>
    </section>
  );
}

function Recruitment({ state, definition, progress, onSelect }) {
  const ids = state.recruitment_candidates || state.completed_encounters.slice(-2);
  const candidates = ids.map((id) => state.route_plan.find((entry) => entry.id === id)
    || definition.journey.opponents.find((entry) => entry.id === id)).filter(Boolean);
  return <section className="journey-decision"><small>Recruitment</small><h2>{candidates.length === 1 ? `${candidates[0].name} wants to join` : 'Choose one new partner'}</h2><p>{candidates.length === 1 ? 'This is the only new candidate from the last two battles.' : 'Both opponents respect your performance. Pick the style you want to train.'}</p><div className="journey-recruits">{candidates.map((candidate) => <article key={candidate.id}><img src={pokemonAssetUrl(candidate.asset)} alt="" /><h3>{candidate.name}</h3><span>{candidate.type} · {candidate.genus}</span><small>{progress?.pokedex?.entries?.find((entry) => entry.id === candidate.id)?.status || 'Seen'}</small><div>{Object.values(SKILL_LABELS).map((label) => <i key={label}>{label[0]}</i>)}</div><button type="button" onClick={() => onSelect(candidate.id)}>Recruit {candidate.name}</button></article>)}</div></section>;
}

function PartnerSelection({ state, definition, progress, onSelect }) {
  return <section className="journey-decision"><small>Partner switch</small><h2>Choose your next partner</h2><div className="journey-partner-options">{(state.roster || []).map((entry) => { const partner = definition.journey.partners.find((item) => item.id === entry.partner_id); if (!partner || !entry.owned) return null; const disabled = entry.fainted || entry.health <= 0; return <button type="button" key={entry.partner_id} disabled={disabled} onClick={() => onSelect(entry.partner_id)}><img src={pokemonAssetUrl(partner.asset)} alt="" /><strong>{partner.name}</strong><span>{entry.health} / {entry.max_health} HP</span><small>{disabled ? 'Fainted' : `Bond ${progress?.bonds?.[partner.id]?.rank || 1}`}</small></button>; })}</div></section>;
}

function RosterStrip({ state, definition }) {
  const subjects = [...(definition.journey.partners || []), ...(state.route_plan || [])];
  return (
    <div className="journey-roster" aria-label="Partner roster">
      {(state.roster || []).filter((entry) => entry.owned).map((entry) => {
        const subject = subjects.find((candidate) => candidate.id === entry.partner_id);
        if (!subject) return null;
        const active = entry.partner_id === state.partner_id;
        const fainted = entry.fainted || entry.health <= 0;
        return (
          <span key={entry.partner_id} className={`${active ? 'is-active' : ''}${fainted ? ' is-fainted' : ''}`}>
            <img src={pokemonAssetUrl(subject.asset)} alt="" />
            <b>{subject.name}</b>
            <small>{fainted ? 'Fainted' : `${entry.health} HP`}</small>
          </span>
        );
      })}
    </div>
  );
}

function GymEntry({ definition, onEnter, onSaveExit }) {
  const gym = definition.journey.gym;
  return <section className="journey-decision journey-gym-entry"><small>Gym entry</small><h2>{gym?.name || 'Stadium Gym'}</h2><p>{gym?.theme || 'A four-opponent piano trial awaits.'}</p><div className="journey-gym-slots" aria-label="Four concealed gym opponents">{[1, 2, 3, 4].map((slot) => <i key={slot}>?</i>)}</div><ul><li>All owned partners heal before entry</li><li>One gym finisher unlocks for this challenge</li></ul><footer><button type="button" onClick={onEnter}>Enter Gym</button><button type="button" onClick={onSaveExit}>Save &amp; Exit</button></footer></section>;
}

function Ceremony({ ceremony, state, definition, onContinue }) {
  const [skippable, setSkippable] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSkippable(true), 500);
    return () => clearTimeout(timer);
  }, []);
  const pokemon = state.route_plan.find((entry) => entry.id === ceremony?.subject_id);
  const badge = definition.journey.gym?.badge;
  const isBadge = ceremony?.type === 'badge';
  useEffect(() => {
    playJourneySfx.play?.(isBadge ? 'gym.badge' : 'partner.caught', { onceKey: `${state.turn}:${ceremony?.id}` });
  }, [ceremony?.id, isBadge, state.turn]);
  return <section className={`journey-ceremony journey-ceremony--${ceremony?.type}`}><small>{isBadge ? 'Gym achievement' : 'New partner'}</small><div className="journey-ceremony__emblem">{isBadge ? '★' : pokemon?.asset ? <img src={pokemonAssetUrl(pokemon.asset)} alt="" /> : '●'}</div><h2>{isBadge ? `${badge?.name || 'Gym Badge'} earned!` : `${pokemon?.name || 'Pokémon'} joined you!`}</h2><p>The reward is saved. Continuing only skips the presentation.</p><button type="button" disabled={!skippable} onClick={onContinue}>Continue <span>C2</span></button></section>;
}

function ChapterSummary({ state, definition, onContinue }) {
  return <section className="journey-decision journey-chapter-summary"><small>Chapter complete</small><h2>{definition.journey.gym?.name || 'Gym'} cleared!</h2><strong>{state.score.toLocaleString()}</strong><div className="journey-score-breakdown"><span><b>{state.completed_encounters.length}</b>victories</span><span><b>{state.practice_attempts.length}</b>performances</span><span><b>{Math.round((state.journey_summary?.breakdown.mean_challenge_score || 0) * 100)}%</b>accuracy</span></div><button type="button" onClick={onContinue}>See badge</button></section>;
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
      <small>Chapter rewards saved</small>
      <h2>Journey complete!</h2>
      <strong>{summary.score.toLocaleString()}</strong>
      <span>{summary.qualified ? 'Ranked score' : `${summary.completed_performances} completed performances · practice saved, score unranked`}</span>
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
  progress,
  leaderboard,
  onChoose,
  onContinue,
  onRetry,
  onSelectRecruit,
  onSelectPartner,
  onStartGym,
  onRestart,
  onChangePartner,
  onAbort,
  onSaveExit,
}) {
  const { state, definition, interaction } = session;
  const partner = definition.journey.partners.find((candidate) => candidate.id === state.partner_id);
  const enemy = state.enemy || definition.journey.opponents[state.current_encounter];
  const [soundSettings, setSoundSettings] = useState(playJourneySfx.settings?.() || { muted: false });
  const legalIds = new Set((interaction?.legal_commands || [])
    .filter((command) => command.type === 'choose_action')
    .map((command) => command.payload.card_instance_id));
  const pendingMove = state.pending_action ? definition.cards[state.pending_action.card_definition_id] : null;

  useEffect(() => {
    if (combatResult && !combatResult.resolving) playJourneySfx(hitClass(combatResult.hitResult));
  }, [combatResult]);
  useEffect(() => {
    if (state.phase === 'checkpoint') playJourneySfx.play?.('encounter.win', { onceKey: `${session.session_id}:win:${state.completed_encounters.length}` });
    if (state.phase === 'defeated') playJourneySfx('defeat');
    if (state.phase === 'gym-entry') playJourneySfx.play?.('gym.intro', { onceKey: `${session.session_id}:gym-intro` });
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
        <div><small>Piano League</small><h1>{definition.title}</h1></div>
        <JourneyPath opponents={state.route_plan || definition.journey.opponents} state={state} />
        <div className="journey-live-score"><small>Run score</small><strong>{state.score.toLocaleString()}</strong></div>
        <button type="button" className="journey-sound" onClick={() => setSoundSettings(playJourneySfx.setMuted?.(!soundSettings.muted) || { muted: !soundSettings.muted })} aria-label={soundSettings.muted ? 'Unmute sound' : 'Mute sound'}>{soundSettings.muted ? 'Sound off' : 'Sound on'}</button>
        {onSaveExit && <button type="button" className="journey-save-exit" onClick={onSaveExit}>Save &amp; Exit</button>}
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
              <RosterStrip state={state} definition={definition} />
              {error && <div className="journey-error">Recovered safely: {error.message}</div>}
            </>
          )}
          {state.phase === 'checkpoint' && <Checkpoint state={state} enemy={enemy} progress={progress} onContinue={onContinue} />}
          {state.phase === 'defeated' && <Defeated enemy={enemy} attempts={state.practice_attempts.length} onRetry={onRetry} />}
          {state.phase === 'recruitment' && <Recruitment state={state} definition={definition} progress={progress} onSelect={onSelectRecruit} />}
          {state.phase === 'partner-selection' && <PartnerSelection state={state} definition={definition} progress={progress} onSelect={onSelectPartner} />}
          {state.phase === 'gym-entry' && <GymEntry definition={definition} onEnter={onStartGym} onSaveExit={onSaveExit} />}
          {state.phase === 'chapter-summary' && <ChapterSummary state={state} definition={definition} onContinue={onContinue} />}
          {state.phase === 'ceremony' && <Ceremony ceremony={state.active_ceremony} state={state} definition={definition} onContinue={onContinue} />}
          {state.phase === 'final-report' && <Checkpoint state={state} enemy={enemy} progress={progress} onContinue={onContinue} />}
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
          {state.zones.hand.map((instance, index) => {
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
                shortcut={['C2', 'D2', 'E2', 'F2', 'G2'][index]}
              />
            );
          })}
        </section>
      )}

      {state.pending_action && (
        <PracticePanel providerRuntime={providerRuntime} move={pendingMove} partner={partner} onAbort={onAbort} onSaveExit={onSaveExit} />
      )}
    </main>
  );
}

export default PokemonJourneyView;
