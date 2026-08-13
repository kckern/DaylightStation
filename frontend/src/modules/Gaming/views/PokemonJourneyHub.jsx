import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconAward,
  IconCalendarCheck,
  IconCheck,
  IconCircle,
  IconCrown,
  IconHome,
  IconPlayerPlay,
  IconPokeball,
  IconSettings,
  IconSparkles,
  IconTargetArrow,
  IconTrophy,
  IconUser,
  IconVolume,
  IconVolumeOff,
  IconX,
} from '@tabler/icons-react';
import { campaignSound } from './journeySfx.js';
import { pokemonAssetUrl, SKILL_LABELS, starText } from './pokemonJourneyModel.js';
import { PokemonJourneyLobby } from './PokemonJourneyLobby.jsx';
import './PokemonJourneyView.scss';

const FILTERS = [
  ['all', 'All'], ['unknown', 'Unknown'], ['seen', 'Seen'], ['caught', 'Caught'],
  ['trainable', 'Trainable'], ['evolve', 'Ready to evolve'], ['mastered', 'Mastered'],
];

function SharedHeader({ title, view, setView, userId, muted, onMute, onSettings, onClose }) {
  const tabs = [
    ['home', 'Home', IconHome],
    ['pokedex', 'Pokédex', IconPokeball],
    ['trainer', 'Trainer', IconUser],
  ];
  return (
    <header className="journey-hub__header">
      <div className="journey-hub__brand"><IconPokeball /><span><small>Piano League</small><h1>Battle Stadium</h1></span></div>
      <nav aria-label={title}>
        {tabs.map(([id, label, TabIcon]) => (
          <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => setView(id)}>
            <TabIcon /><span>{label}</span>
          </button>
        ))}
      </nav>
      <span className="journey-hub__player"><IconUser /><strong>{userId}</strong></span>
      <button type="button" className="journey-icon-button" onClick={onMute} aria-label={muted ? 'Unmute sound' : 'Mute sound'}>{muted ? <IconVolumeOff /> : <IconVolume />}</button>
      <button type="button" className="journey-icon-button" onClick={onSettings} aria-label="Settings"><IconSettings /></button>
      {onClose && <button type="button" className="journey-close" onClick={onClose} aria-label="Close game"><IconX /></button>}
    </header>
  );
}

function HomeView({ definition, progress, onResume, onStart }) {
  const active = progress?.campaign?.active_session;
  const daily = progress?.daily;
  const weekly = progress?.weekly;
  const favorite = definition.journey.partners.find((partner) => partner.id === progress?.favorite_partner?.partner_id);
  const hero = favorite || definition.journey.partners[0];
  const gym = progress?.campaign?.next_gym;
  const featuredSkill = daily?.featured_skill_label || 'featured skill';
  const goal = active
    ? `Battle ${active.battle} · ${active.phase.replaceAll('-', ' ')}`
    : `Win 1 battle · ${featuredSkill} 50%`;
  return (
    <section className="journey-home" aria-label="Card Game home">
      <article className="journey-home__hero">
        <div className="journey-home__hero-copy">
          <span className="journey-kicker"><IconPokeball /> Chapter {progress?.campaign?.chapter || 1}</span>
          <h2>{active ? 'Your next battle is ready!' : progress?.journeys_completed ? 'Return to the Stadium!' : 'Your Pokémon journey starts here!'}</h2>
          <div className="journey-goal"><IconTargetArrow /><span><small>Next goal</small><strong>{goal}</strong></span></div>
          <button type="button" onClick={active ? onResume : onStart}><IconPlayerPlay />{active ? 'Continue journey' : progress?.journeys_completed ? 'Play again' : 'Choose a partner'}</button>
        </div>
        <div className={`journey-home__hero-art journey-home__hero-art--${hero?.type || 'normal'}`}>
          {hero?.asset && <img src={pokemonAssetUrl(hero.asset)} alt={hero.name} />}
          <span className="journey-home__partner"><small>Top partner</small><strong>{hero?.name}</strong></span>
          <div className="journey-home__gym">
            <IconAward />
            <span><small>Next gym</small><strong>{gym?.name || 'Stadium Final'}</strong><em>{gym?.badge?.name || 'Badge challenge'}</em></span>
          </div>
        </div>
      </article>
      <aside className="journey-home__side">
        <article className="journey-quest-card">
          <header><IconCalendarCheck /><span><small>Today</small><strong>{featuredSkill} quest</strong></span></header>
          <ul>
            <li className={daily?.battle_complete ? 'is-done' : ''}>{daily?.battle_complete ? <IconCheck /> : <IconCircle />}<span>Win a battle</span></li>
            <li className={daily?.skill_complete ? 'is-done' : ''}>{daily?.skill_complete ? <IconCheck /> : <IconCircle />}<span>Score 50% in {featuredSkill}</span></li>
          </ul>
          <footer><IconSparkles /><strong>25 XP</strong><span>+ 1 stamp</span><span>+ 2 coins</span></footer>
        </article>
        <article className="journey-stamp-card">
          <header><IconTrophy /><span><small>This week</small><strong>Stamp rally</strong></span><b>{weekly?.stamp_count || 0}/4</b></header>
          <div className="journey-stamps" aria-label={`${weekly?.stamp_count || 0} of 4 stamps`}>
            {[0, 1, 2, 3].map((index) => <i key={index} className={index < (weekly?.stamp_count || 0) ? 'is-stamped' : ''}>{index < (weekly?.stamp_count || 0) ? <IconPokeball /> : index + 1}</i>)}
          </div>
        </article>
      </aside>
      <footer className="journey-summary-strip">
        <span><IconPokeball /><b>{progress?.pokedex?.caught || 0}/50</b><small>Pokédex</small></span>
        <span><IconSparkles /><b>Bond {progress?.favorite_partner?.bond_rank || 1}</b><small>{favorite?.name || hero?.name}</small></span>
        <span><IconCrown /><b>Level {progress?.trainer?.level || 1}</b><small>Trainer</small></span>
        <span><IconAward /><b>{progress?.badges?.length || 0}</b><small>Badges</small></span>
      </footer>
    </section>
  );
}

function PokedexView({ progress }) {
  const entries = useMemo(() => progress?.pokedex?.entries || [], [progress?.pokedex?.entries]);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(entries.find((entry) => entry.caught)?.id || entries[0]?.id);
  const filtered = useMemo(() => entries.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'unknown') return entry.status === 'unknown';
    if (filter === 'seen') return entry.seen && !entry.caught;
    if (filter === 'caught') return entry.caught;
    if (filter === 'trainable') return entry.trainable;
    if (filter === 'evolve') return entry.trainable && entry.bond_rank === 3;
    return entry.status === 'mastered';
  }), [entries, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  const safePage = Math.min(page, pages - 1);
  const selected = entries.find((entry) => entry.id === selectedId) || filtered[0] || entries[0];
  const nextBond = selected?.bond_checklist?.find((item) => !item.complete)
    || selected?.bond_checklist?.at(-1);
  return (
    <section className="journey-pokedex" aria-label="Pokédex">
      <div className="journey-pokedex__browser">
        <header><div><span className="journey-kicker">Collection</span><h2>Pokédex</h2></div><strong>{progress?.pokedex?.caught || 0} / 50 caught</strong></header>
        <div className="journey-filters" aria-label="Pokédex filters">
          {FILTERS.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'is-active' : ''} onClick={() => { setFilter(id); setPage(0); }}>{label}</button>)}
        </div>
        <div className="journey-dex-grid">
          {filtered.slice(safePage * 8, safePage * 8 + 8).map((entry) => (
            <button type="button" key={entry.id} className={`${selected?.id === entry.id ? 'is-selected' : ''} ${entry.status === 'unknown' ? 'is-unknown' : ''}`} onClick={() => setSelectedId(entry.id)}>
              <span>{entry.dex ? `#${entry.dex}` : '???'}</span>
              {entry.asset ? <img src={pokemonAssetUrl(entry.asset)} alt="" /> : <i aria-hidden="true"><IconPokeball /></i>}
              <strong>{entry.name || 'Unknown'}</strong><small>{entry.status === 'unknown' ? entry.habitat : entry.status}</small>
            </button>
          ))}
        </div>
        <footer className="journey-pagination"><button type="button" disabled={safePage === 0} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {safePage + 1} / {pages}</span><button type="button" disabled={safePage + 1 >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></footer>
      </div>
      <article className="journey-dex-detail">
        {selected && <>
          <header><span className="journey-status-chip">{selected.status}</span><h2>{selected.name || 'Unknown Pokémon'}</h2><small>{selected.genus || selected.habitat}</small></header>
          <div className="journey-dex-facts"><span><b>{selected.encounter_count}</b> encounters</span><span><b>{selected.battle_wins}</b> wins</span><span><b>{selected.distinct_training_days}</b> training days</span><span><b>{selected.bond_rank}</b> bond rank</span></div>
          <section><h3>Best piano scores</h3>{Object.entries(selected.best_scores || {}).map(([kind, score]) => <p key={kind}><span>{SKILL_LABELS[kind]}</span><b>{score == null ? '—' : `${Math.round(score * 100)}%`}</b></p>)}</section>
          {nextBond && <section className="journey-bond-list"><h3>Next bond level</h3><p className={nextBond.complete ? 'is-done' : ''}><b>{nextBond.complete ? <IconCheck /> : nextBond.rank}</b><span>{nextBond.label}</span></p></section>}
          {selected.evolution && <div className="journey-evolution-preview"><small>Evolution preview</small><strong>{selected.evolution.name}</strong></div>}
          {selected.ceremonies?.length > 0 && <button type="button">Replay earned ceremony</button>}
        </>}
      </article>
    </section>
  );
}

function TrainerView({ progress, leaderboard }) {
  const trainer = progress?.trainer || {};
  const xpPercent = trainer.next_level_xp ? Math.round((trainer.xp_into_level / 250) * 100) : 0;
  return (
    <section className="journey-trainer" aria-label="Trainer profile">
      <article className="journey-trainer__profile journey-dashboard-card">
        <IconUser className="journey-trainer__avatar" />
        <span className="journey-kicker">Trainer</span><h2>Level {trainer.level || 1}</h2><strong>{trainer.title || 'Rookie Trainer'}</strong>
        <div className="journey-xp" style={{ '--xp': `${xpPercent}%` }}><span><b>{trainer.xp || 0} XP</b><em>Next: {trainer.next_level_xp || 250}</em></span><i><u /></i></div>
        <label>Display title<select value={trainer.title || 'Rookie Trainer'} readOnly>{(trainer.selectable_titles || ['Rookie Trainer']).map((title) => <option key={title}>{title}</option>)}</select></label>
      </article>
      <article className="journey-dashboard-card journey-skill-case"><h3><IconSparkles /> Piano skills</h3>{Object.entries(trainer.skill_stars || {}).map(([kind, skill]) => <div key={kind}><span><b>{SKILL_LABELS[kind]}</b><small>Best {skill.best_score == null ? '—' : `${Math.round(skill.best_score * 100)}%`}</small></span><strong aria-label={`${skill.stars} stars`}>{starText(skill.stars)}</strong></div>)}</article>
      <article className="journey-dashboard-card journey-badge-case"><h3><IconAward /> Gym badges</h3><div>{progress?.badges?.length ? progress.badges.map((badge) => <button type="button" key={badge.id} aria-label={`Replay ${badge.id} ceremony`}><IconAward /><small>{badge.id}</small></button>) : <p><IconAward /><span><strong>Your first badge awaits!</strong><em>Complete a journey to challenge the gym.</em></span></p>}</div></article>
      <aside className="journey-trainer__side"><article className="journey-dashboard-card"><IconCalendarCheck /><span><small>Practice streak</small><strong>{progress?.streak?.days || 0} days</strong></span></article><article className="journey-dashboard-card"><IconTrophy /><span><small>Household leader</small><strong>{leaderboard?.standings?.[0]?.display_name || 'No leader yet'}</strong><b>{leaderboard?.standings?.[0]?.score?.toLocaleString() || 'Play a ranked run'}</b></span></article></aside>
    </section>
  );
}

function SettingsDialog({ title, settings, onChange, onClose }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector('button')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus?.(); };
  }, [onClose]);
  return <div className="journey-settings-backdrop"><section ref={dialogRef} className="journey-settings" role="dialog" aria-modal="true" aria-label={`${title} settings`}><header><h2><IconSettings /> Settings</h2><button type="button" onClick={onClose} aria-label="Close settings"><IconX /></button></header><label><span>Sound effects<small>Battle sounds and rewards</small></span><input type="checkbox" checked={!settings.muted} onChange={(event) => onChange({ muted: !event.target.checked })} /></label><label><span>Reduced motion<small>Use calmer transitions</small></span><input type="checkbox" checked={settings.reducedEffects} onChange={(event) => onChange({ reducedEffects: event.target.checked })} /></label></section></div>;
}

export function PokemonJourneyHub({ definition, progress, leaderboard, userId, onStart, onResume, onClose }) {
  const [view, setView] = useState('home');
  const [choosingPartner, setChoosingPartner] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(campaignSound.settings());
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const applySettings = (patch) => {
    if ('muted' in patch) campaignSound.setMuted(patch.muted);
    if ('reducedEffects' in patch) campaignSound.setReducedEffects(patch.reducedEffects);
    setSettings(campaignSound.settings());
  };
  if (choosingPartner) return <PokemonJourneyLobby definition={definition} progress={progress} leaderboard={leaderboard} userId={userId} onSelect={onStart} onClose={() => setChoosingPartner(false)} />;
  return (
    <main className={`gaming-shell pokemon-journey journey-hub${settings.reducedEffects ? ' reduced-effects' : ''}`}>
      <SharedHeader title={definition.title} view={view} setView={setView} userId={userId} muted={settings.muted} onMute={() => applySettings({ muted: !settings.muted })} onSettings={() => setSettingsOpen(true)} onClose={onClose} />
      {view === 'home' && <HomeView definition={definition} progress={progress} onResume={onResume} onStart={() => setChoosingPartner(true)} />}
      {view === 'pokedex' && <PokedexView progress={progress} />}
      {view === 'trainer' && <TrainerView progress={progress} leaderboard={leaderboard} />}
      {settingsOpen && <SettingsDialog title={definition.title} settings={settings} onChange={applySettings} onClose={closeSettings} />}
    </main>
  );
}

export default PokemonJourneyHub;
