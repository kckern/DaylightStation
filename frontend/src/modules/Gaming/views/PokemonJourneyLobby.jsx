import './PokemonJourneyView.scss';
import { pokemonAssetUrl, SKILL_LABELS, starText } from './pokemonJourneyModel.js';

function RecordStrip({ leaderboard, userId }) {
  const weekly = leaderboard?.standings?.find((entry) => entry.user_id === userId);
  return (
    <div className="journey-record-strip" aria-label="Household records">
      <span><small>Your weekly best</small><strong>{weekly?.score?.toLocaleString() || '—'}</strong></span>
      <span><small>Household record</small><strong>{leaderboard?.alltime?.score?.toLocaleString() || '—'}</strong></span>
      <span><small>Leader</small><strong>{leaderboard?.alltime?.display_name || 'Be first!'}</strong></span>
    </div>
  );
}

export function PokemonJourneyLobby({ definition, progress, leaderboard, userId, onSelect, onClose }) {
  const skills = progress?.skill_stars || {};
  return (
    <main className="gaming-shell pokemon-journey journey-lobby" aria-label="Choose a Pokémon partner">
      <header className="journey-topbar">
        <div><small>Piano League</small><h1>Scale Stadium</h1></div>
        <RecordStrip leaderboard={leaderboard} userId={userId} />
        {onClose && <button type="button" className="journey-close" onClick={onClose} aria-label="Close game">×</button>}
      </header>

      <section className="journey-lobby__intro">
        <span className="journey-kicker">Three battles · four piano skills · one household leaderboard</span>
        <h2>Choose your practice partner</h2>
        <p>Every move is powered by what you play. Partner types change the style—not the score.</p>
      </section>

      <section className="journey-starters">
        {definition.journey.partners.map((partner) => {
          const partnerProgress = progress?.partners?.[partner.id];
          const display = partnerProgress?.evolved ? partnerProgress.evolution : partner;
          return (
            <button
              type="button"
              key={partner.id}
              className={`journey-starter journey-starter--${partner.type}${partnerProgress?.mastery_aura ? ' has-aura' : ''}`}
              onClick={() => onSelect(partner.id)}
            >
              <span className="journey-starter__status">
                {partnerProgress?.evolved ? 'Evolved partner' : 'Practice partner'}
              </span>
              <img src={pokemonAssetUrl(display.asset)} alt="" draggable="false" />
              <strong>{display.name}</strong>
              <span>{partner.genus}</span>
              <small>{partnerProgress?.journeys_completed || 0} journeys complete</small>
            </button>
          );
        })}
      </section>

      <footer className="journey-mastery" aria-label="Piano mastery">
        {Object.entries(SKILL_LABELS).map(([kind, label]) => (
          <span key={kind}>
            <small>{label}</small>
            <strong aria-label={`${skills[kind]?.stars || 0} stars`}>{starText(skills[kind]?.stars)}</strong>
          </span>
        ))}
        {progress?.persistent === false && <em>Guest runs are not ranked or saved.</em>}
      </footer>
    </main>
  );
}

export default PokemonJourneyLobby;
