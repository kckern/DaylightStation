// FitnessMomentum.jsx — one flat glass panel: a household momentum headline plus
// a per-person row. "Effort" is HR-zone-weighted (cool omitted). Under each
// person sit `compareWeeks` same-scale bars (one per 7-day window, oldest→newest)
// so this week visibly stacks up against recent weeks. Names resolve through
// DisplayNameResolver (group label → "Dad").
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { resolveUserDisplayName } from '@/hooks/fitness/DisplayNameResolver.js';
import getLogger from '@/lib/logging/Logger.js';
import { computeMomentum } from './momentum.js';
import './FitnessMomentum.scss';

const logger = getLogger().child({ component: 'fitness-momentum' });

// Low → high intensity, stacked bottom → top within a bar.
const ZONE_STACK = ['fire', 'hot', 'warm', 'active']; // DOM order = top → bottom
const ZONE_VAR = {
  active: 'var(--zone-active)',
  warm: 'var(--zone-warm)',
  hot: 'var(--zone-hot)',
  fire: 'var(--zone-fire)',
};

/** One vertical, zone-stacked weekly bar. Height = effort relative to `maxMinutes`. */
function WeekBar({ week, maxMinutes }) {
  const fillPct = maxMinutes > 0 ? (week.effortMinutes / maxMinutes) * 100 : 0;
  const total = week.effortMinutes || 1;
  return (
    <span
      className={`fitness-momentum__weekbar${week.current ? ' is-current' : ''}`}
      title={`${week.effortMinutes} min`}
    >
      <span className="fitness-momentum__weekfill" style={{ height: `${fillPct.toFixed(1)}%` }}>
        {ZONE_STACK.map((z) => (
          week.zones[z] > 0 ? (
            <span
              key={z}
              className="fitness-momentum__weekseg"
              style={{ height: `${((week.zones[z] / total) * 100).toFixed(1)}%`, background: ZONE_VAR[z] }}
            />
          ) : null
        ))}
      </span>
    </span>
  );
}

/** A person's (or the household's) same-scale weekly bar chart. */
function WeekBars({ weeks }) {
  const maxMinutes = Math.max(1, ...weeks.map((w) => w.effortMinutes));
  return (
    <span className="fitness-momentum__weeks">
      {weeks.map((w, i) => <WeekBar key={i} week={w} maxMinutes={maxMinutes} />)}
    </span>
  );
}

function Avatar({ id, name }) {
  const [failed, setFailed] = React.useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) return <span className="fitness-momentum__avatar fitness-momentum__avatar--fallback">{initials}</span>;
  return <img className="fitness-momentum__avatar" src={`/api/v1/static/img/users/${id}`} alt={name} onError={() => setFailed(true)} />;
}

export default function FitnessMomentum() {
  // The 'sessions' source returns a wrapped object ({ sessions, total, ... }),
  // not a bare array (see FitnessSessionsWidget) — unwrap before computing.
  const rawSessions = useScreenData('sessions');
  const sessions = Array.isArray(rawSessions) ? rawSessions : (rawSessions?.sessions || []);
  const { roster, householdLabel, windowDays, compareWeeks } = useFitnessScreen();

  // Short, family-friendly names via the device-agnostic resolver ("Dad" etc.).
  const nameById = useMemo(() => {
    const map = new Map();
    for (const u of (roster || [])) {
      map.set(u.id, resolveUserDisplayName(u, { preferGroupLabels: true }).displayName);
    }
    return map;
  }, [roster]);

  const data = useMemo(
    () => computeMomentum(sessions, roster, { householdLabel, windowDays, compareWeeks }),
    [sessions, roster, householdLabel, windowDays, compareWeeks],
  );

  logger.sampled('momentum.render', { members: data.members.length, householdMin: data.household.effortMinutes },
    { maxPerMinute: 12, aggregate: true });

  const { household, members } = data;
  const anyActive = household.weeks.some((w) => w.effortMinutes > 0);

  return (
    <div className="fitness-momentum">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        <span className="fitness-momentum__window">· last {household.windowDays} days</span>
        <span className="fitness-momentum__house-min">{household.effortMinutes} min this week</span>
      </div>

      {!anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no credited minutes yet.</div>
      )}

      <div className="fitness-momentum__cards">
        {members.map((m) => (
          <div key={m.id} className="fitness-momentum__card">
            <Avatar id={m.avatarId} name={m.name} />
            <span className="fitness-momentum__name">{nameById.get(m.id) || m.name}</span>
            <WeekBars weeks={m.weeks} />
            <span className="fitness-momentum__min">{m.effortMinutes} min</span>
          </div>
        ))}
      </div>
    </div>
  );
}
