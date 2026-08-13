import './PokemonJourneyView.scss';
import {
  IconDroplet,
  IconFlame,
  IconLeaf,
  IconPokeball,
  IconSparkles,
  IconTrophy,
  IconX,
} from '@tabler/icons-react';
import { pokemonAssetUrl, SKILL_LABELS, starText } from './pokemonJourneyModel.js';

const PARTNER_ICONS = { grass: IconLeaf, fire: IconFlame, water: IconDroplet };

function RecordStrip({ leaderboard, userId }) {
  const weekly = leaderboard?.standings?.find((entry) => entry.user_id === userId);
  return (
    <div className="journey-record-strip" aria-label="Household records">
      <span><IconSparkles /><small>Your best</small><strong>{weekly?.score?.toLocaleString() || '—'}</strong></span>
      <span><IconTrophy /><small>Record</small><strong>{leaderboard?.alltime?.score?.toLocaleString() || '—'}</strong></span>
      <span><IconPokeball /><small>Leader</small><strong>{leaderboard?.alltime?.display_name || 'Be first!'}</strong></span>
    </div>
  );
}

export function PokemonJourneyLobby({ definition, progress, leaderboard, userId, onSelect, onClose }) {
  const skills = progress?.skill_stars || {};
  return (
    <main className="gaming-shell pokemon-journey journey-lobby" aria-label="Choose a Pokémon partner">
      <header className="journey-topbar">
        <div><small>Piano League</small><h1>Battle Stadium</h1></div>
        <RecordStrip leaderboard={leaderboard} userId={userId} />
        {onClose && <button type="button" className="journey-close" onClick={onClose} aria-label="Back"><IconX /></button>}
      </header>

      <section className="journey-lobby__intro">
        <span className="journey-kicker"><IconPokeball /> New journey</span>
        <h2>Choose your partner</h2>
        <p>Pick your favorite—every partner trains all four piano skills.</p>
      </section>

      <section className="journey-starters">
        {definition.journey.partners.map((partner) => {
          const partnerProgress = progress?.partners?.[partner.id];
          const display = partnerProgress?.evolved ? partnerProgress.evolution : partner;
          const TypeIcon = PARTNER_ICONS[partner.type] || IconPokeball;
          return (
            <button
              type="button"
              key={partner.id}
              className={`journey-starter journey-starter--${partner.type}${partnerProgress?.mastery_aura ? ' has-aura' : ''}`}
              onClick={() => onSelect(partner.id)}
            >
              <span className="journey-starter__status">
                <TypeIcon /> {partnerProgress?.evolved ? 'Evolved' : partner.type}
              </span>
              <img src={pokemonAssetUrl(display.asset)} alt="" draggable="false" />
              <strong>{display.name}</strong>
              <span>{partner.genus}</span>
              <small>{partnerProgress?.journeys_completed ? `${partnerProgress.journeys_completed} journeys` : 'Ready to adventure'}</small>
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
