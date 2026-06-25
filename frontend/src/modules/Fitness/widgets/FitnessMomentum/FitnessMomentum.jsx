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

/** 'M/d' label from an epoch-ms window start (local date). */
function mdLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Log-scaled segment heights within a bar. Active minutes usually dwarf the
 * higher zones; a ln(1+m) weighting compresses the big chunks so a little hot/
 * fire still earns a visible band. Heights are fractions of the bar fill, so
 * they always sum to the full fill (the fill height itself stays linear in
 * effort for honest week-over-week comparison).
 */
function zoneFractions(zones) {
  const weights = ZONE_STACK.map((z) => ({ z, w: zones[z] > 0 ? Math.log1p(zones[z]) : 0 }));
  const sum = weights.reduce((s, x) => s + x.w, 0);
  if (sum <= 0) return [];
  return weights.filter((x) => x.w > 0).map((x) => ({ z: x.z, frac: x.w / sum }));
}

// Stable per-bar skeleton heights (deterministic so it doesn't twitch each frame).
const SKELETON_HEIGHTS = [42, 64, 38, 72, 50, 60, 46, 68];

/** One vertical, log-stacked weekly bar with an M/d label. Height = effort vs `maxMinutes`. */
function WeekBar({ week, maxMinutes, index, loading }) {
  const fillPct = loading
    ? SKELETON_HEIGHTS[index % SKELETON_HEIGHTS.length]
    : (maxMinutes > 0 ? (week.effortMinutes / maxMinutes) * 100 : 0);
  const fracs = loading ? [] : zoneFractions(week.zones);
  return (
    <span className="fitness-momentum__weekcol">
      {/* reserve the top-axis height during load so nothing reflows on hydrate */}
      <span className={`fitness-momentum__weektop${week.current ? ' is-current' : ''}`}>
        {loading ? ' ' : week.effortMinutes}
      </span>
      <span
        className={`fitness-momentum__weekbar${week.current && !loading ? ' is-current' : ''}`}
        title={loading ? '' : `${week.effortMinutes} min`}
      >
        <span
          className={`fitness-momentum__weekfill${loading ? ' skeleton shimmer' : ''}`}
          style={{ height: `${fillPct.toFixed(1)}%` }}
        >
          {fracs.map(({ z, frac }) => (
            <span
              key={z}
              className="fitness-momentum__weekseg"
              style={{ height: `${(frac * 100).toFixed(1)}%`, background: ZONE_VAR[z] }}
            />
          ))}
        </span>
      </span>
      <span className={`fitness-momentum__weeklabel${week.current ? ' is-current' : ''}`}>{mdLabel(week.startMs)}</span>
    </span>
  );
}

/** A person's (or the household's) same-scale weekly bar chart. */
function WeekBars({ weeks, loading }) {
  const maxMinutes = Math.max(1, ...weeks.map((w) => w.effortMinutes));
  return (
    <span className="fitness-momentum__weeks">
      {weeks.map((w, i) => <WeekBar key={i} week={w} index={i} maxMinutes={maxMinutes} loading={loading} />)}
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
  // Before the first fetch resolves it is null/undefined → render a right-sized
  // skeleton (same layout as loaded) so hydration doesn't reflow the cards.
  const rawSessions = useScreenData('sessions');
  const loading = rawSessions == null;
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
        {loading
          ? <span className="fitness-momentum__house-min fitness-momentum__house-min--skel skeleton shimmer" aria-hidden="true" />
          : <span className="fitness-momentum__house-min">{household.effortMinutes} min this week</span>}
      </div>

      {/* Only show the empty-state once we KNOW there's no data — never during load. */}
      {!loading && !anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no credited minutes yet.</div>
      )}

      <div className="fitness-momentum__cards">
        {members.map((m) => (
          <div key={m.id} className="fitness-momentum__card">
            <Avatar id={m.avatarId} name={m.name} />
            <span className="fitness-momentum__name">{nameById.get(m.id) || m.name}</span>
            <WeekBars weeks={m.weeks} loading={loading} />
          </div>
        ))}
      </div>
    </div>
  );
}
