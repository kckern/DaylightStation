// FitnessMomentum.jsx — one flat glass panel: a household weekly-ring headline
// plus one row per person. Bars are fixed Monday weeks, not rolling windows;
// their height and labels are rings while their bands retain the familiar
// green/yellow/orange/red contribution breakdown.
import React, { useMemo } from 'react';
import { useScreenData } from '@/screen-framework/data/useScreenData.js';
import { useFitnessScreen } from '@/modules/Fitness/useFitnessScreen.js';
import { resolveUserDisplayName } from '@/hooks/fitness/DisplayNameResolver.js';
import RingIcon from '@/lib/icons/RingIcon.jsx';
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
 * Log-scaled segment heights within a bar. Active-zone rings usually dwarf the
 * higher zones; a ln(1+r) weighting compresses the big chunks so a little hot/
 * fire still earns a visible band. Heights are fractions of the bar fill, so
 * they always sum to the full fill (which stays linear in rings for an honest
 * week-over-week comparison).
 */
function zoneFractions(zones) {
  const weights = ZONE_STACK.map((z) => ({ z, w: zones[z] > 0 ? Math.log1p(zones[z]) : 0 }));
  const sum = weights.reduce((s, x) => s + x.w, 0);
  if (sum <= 0) return [];
  return weights.filter((x) => x.w > 0).map((x) => ({ z: x.z, frac: x.w / sum }));
}

// Stable per-bar skeleton heights (deterministic so it doesn't twitch each frame).
const SKELETON_HEIGHTS = [42, 64, 38, 72, 50, 60, 46, 68];

/** One vertical, log-stacked weekly bar with an M/d label. Height = rings vs max. */
function WeekBar({ week, maxRings, index, loading }) {
  const fillPct = loading
    ? SKELETON_HEIGHTS[index % SKELETON_HEIGHTS.length]
    : (maxRings > 0 ? (week.rings / maxRings) * 100 : 0);
  const fracs = loading ? [] : zoneFractions(week.zones);
  return (
    <span className="fitness-momentum__weekcol">
      {/* reserve the top-axis height during load so nothing reflows on hydrate */}
      <span className={`fitness-momentum__weektop${week.current ? ' is-current' : ''}`}>
        {loading ? ' ' : week.rings.toLocaleString()}
      </span>
      <span
        className={`fitness-momentum__weekbar${week.current && !loading ? ' is-current' : ''}`}
        title={loading ? '' : `${week.rings.toLocaleString()} rings`}
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
  const maxRings = Math.max(1, ...weeks.map((w) => w.rings));
  return (
    <span className="fitness-momentum__weeks">
      {weeks.map((w, i) => <WeekBar key={w.startMs ?? i} week={w} index={i} maxRings={maxRings} loading={loading} />)}
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
  const { roster, householdLabel, compareWeeks, zoneRingRates } = useFitnessScreen();

  // Short, family-friendly names via the device-agnostic resolver ("Dad" etc.).
  const nameById = useMemo(() => {
    const map = new Map();
    for (const u of (roster || [])) {
      map.set(u.id, resolveUserDisplayName(u, { preferGroupLabels: true }).displayName);
    }
    return map;
  }, [roster]);

  const data = useMemo(
    () => computeMomentum(
      Array.isArray(rawSessions) ? rawSessions : (rawSessions?.sessions || []),
      roster,
      { householdLabel, compareWeeks, zoneRingRates },
    ),
    [rawSessions, roster, householdLabel, compareWeeks, zoneRingRates],
  );

  logger.sampled('momentum.render', {
    members: data.members.length,
    householdRings: data.household.rings,
    weekStartMs: data.household.weekStartMs,
  },
    { maxPerMinute: 12, aggregate: true });

  const { household, members } = data;
  const anyActive = household.weeks.some((w) => w.rings > 0);

  return (
    <div className="fitness-momentum">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        <span className="fitness-momentum__window">· Monday–today</span>
        {loading
          ? <span className="fitness-momentum__house-rings fitness-momentum__house-rings--skel skeleton shimmer" aria-hidden="true" />
          : (
            <span className="fitness-momentum__house-rings" title="Household rings this week">
              <RingIcon size="1.35em" spin="once" label={`${household.rings} household rings this week`} />
              <span>{household.rings.toLocaleString()}</span>
            </span>
          )}
      </div>

      {/* Only show the empty-state once we KNOW there's no data — never during load. */}
      {!loading && !anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no rings yet this week.</div>
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
