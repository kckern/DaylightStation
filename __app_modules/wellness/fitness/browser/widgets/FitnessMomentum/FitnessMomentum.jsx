// FitnessMomentum.jsx — one flat glass panel: a household weekly-ring headline
// plus one card per person. Each card, top to bottom: the avatar with its name
// tag, this week's rings (the number to read from across the garage), the four
// Monday weeks as bars (height = rings, bands = the green/yellow/orange/red
// zone breakdown, current week highlighted) and a rail with bank silver and one
// chip per area the person has EARNED gems in this week. The rail opens the Gem
// Board; it sits at the foot of the card so a child can reach it on the touch
// screen. Bars carry no numbers or dates: at four to a column they cannot be
// read from the room, and the week's figure is the hero above them.
import React, { useMemo, useRef, useState } from 'react';
import { useScreenData } from "../../../../../../__capabilities/screen-host/browser/data.mjs";
import { useFitnessScreen } from "../../useFitnessScreen.js";
import { resolveUserDisplayName } from "../../hooks/fitness/DisplayNameResolver.js";
import RingIcon from '@/lib/icons/RingIcon.jsx';
import CoinIcon from '@/lib/icons/CoinIcon.jsx';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import GemGlyph from '@/lib/economy/GemBoard/GemGlyph.jsx';
import { AREAS } from '@/lib/economy/GemBoard/AreaIcon.jsx';
import getLogger from '@/lib/logging/Logger.js';
import GemBoardOverlay from '@/lib/economy/GemBoard/GemBoard.jsx';
import { useGamepadKeys } from "../../lib/useGamepadKeys.js";
import { computeMomentum } from "./momentum.js";
import "./FitnessMomentum.scss";

const logger = getLogger().child({ component: 'fitness-momentum' });

// Low → high intensity, stacked bottom → top within a bar.
const ZONE_STACK = ['fire', 'hot', 'warm', 'active']; // DOM order = top → bottom

const ZONE_VAR = {
  active: 'var(--zone-active)',
  warm: 'var(--zone-warm)',
  hot: 'var(--zone-hot)',
  fire: 'var(--zone-fire)',
};

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

/** One vertical, log-stacked weekly bar. Height = rings vs the person's best week. */
function WeekBar({ week, maxRings, index, loading }) {
  const fillPct = loading
    ? SKELETON_HEIGHTS[index % SKELETON_HEIGHTS.length]
    : (maxRings > 0 ? (week.rings / maxRings) * 100 : 0);
  const fracs = loading ? [] : zoneFractions(week.zones);
  return (
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

const AREA_WORDS = { move: 'Move', school: 'School', games: 'Games' };

/**
 * The areas a person has EARNED gems in this week (`purse.gems`, rolled up by
 * the server in Move · School · Games order). Nothing in progress, leading or
 * zero ever reaches this list; anything malformed is dropped rather than drawn.
 */
export function earnedChips(purse) {
  return (Array.isArray(purse?.gems) ? purse.gems : [])
    .filter((g) => AREAS.includes(g?.area) && Number.isInteger(g.earned) && g.earned > 0 && typeof g.color === 'string');
}

/**
 * The foot of a card: bank silver, then one chip per area with gems earned
 * this week — the board's own gem (area colour, area icon) and ×N past one. A
 * child with nothing earned shows silver alone. One button, opening the board
 * on this person. Someone without a wallet gets an empty rail, which still
 * takes the row's foot height (the cards share their rows), so every card's
 * bars sit on one baseline.
 */
function Rail({ purse, name, onOpen }) {
  if (!purse) return <span className="fitness-momentum__rail fitness-momentum__rail--empty" aria-hidden="true" />;
  const chips = earnedChips(purse);
  const words = [
    `${name}: ${purse.silver} silver`,
    ...chips.map((g) => `${AREA_WORDS[g.area]}: ${g.earned} ${g.earned === 1 ? 'gem' : 'gems'} this week`),
  ].join('. ');
  return (
    <button type="button" className="fitness-momentum__rail" aria-label={`${words}. Open the gem board`} onClick={onOpen}>
      <span className="fitness-momentum__silver">
        <CoinIcon metal="silver" size="1em" className="fitness-momentum__coin" />
        <span className="fitness-momentum__count">{purse.silver}</span>
      </span>
      {chips.map((g) => (
        <span key={g.area} className="fitness-momentum__chip" data-area={g.area}>
          <GemGlyph cell={{ state: 'earned', week: 1 }} color={g.color} area={g.area} />
          {g.earned > 1 && <span className="fitness-momentum__times">×{g.earned}</span>}
        </span>
      ))}
    </button>
  );
}

/** This week's rings for one person: the largest thing on the card. */
function Hero({ rings, loading }) {
  if (loading) return <span className="fitness-momentum__hero fitness-momentum__hero--skel skeleton shimmer" aria-hidden="true" />;
  return (
    <span className="fitness-momentum__hero" aria-label={`${rings.toLocaleString()} rings this week`}>
      <RingIcon size="1em" />
      <span>{rings.toLocaleString()}</span>
    </span>
  );
}

export default function FitnessMomentum() {
  // The 'sessions' source returns a wrapped object ({ sessions, total, ... }),
  // not a bare array (see FitnessSessionsWidget) — unwrap before computing.
  // Before the first fetch resolves it is null/undefined → render a right-sized
  // skeleton (same layout as loaded) so hydration doesn't reflow the cards.
  const rawSessions = useScreenData('sessions');
  const loading = rawSessions == null;
  // Bank silver and the gems earned this week per learner (/api/v1/earnings/standings).
  // Missing, failed or economy-off → empty rails; the ring bars stand alone.
  const rawStandings = useScreenData('standings');
  const purseById = useMemo(() => {
    const map = new Map();
    if (!rawStandings || rawStandings.mode === 'off') return map;
    for (const l of rawStandings.learners || []) map.set(l.learnerId, l);
    return map;
  }, [rawStandings]);
  const { roster, householdLabel, compareWeeks, zoneRingRates } = useFitnessScreen();
  // The Gem Board: opened from a card's rail (focused on that child) or the
  // headline's gem chip. The garage pads drive it while it is open.
  const economyOn = Boolean(rawStandings) && rawStandings.mode !== 'off';
  const [board, setBoard] = useState(null); // null closed, else { focus }
  const boardKeys = useRef(null);
  useGamepadKeys(board != null, (key) => boardKeys.current?.(key));

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
    <div className="fitness-momentum screen-surface">
      <div className="fitness-momentum__headline">
        <span className="fitness-momentum__flame">🔥</span>
        <span className="fitness-momentum__house">{household.label}</span>
        <span className="fitness-momentum__window">· this week</span>
        {loading
          ? <span className="fitness-momentum__house-rings fitness-momentum__house-rings--skel skeleton shimmer" aria-hidden="true" />
          : (
            <span className="fitness-momentum__house-rings" title="Household rings this week">
              <RingIcon size="1.1em" spin="once" label={`${household.rings} household rings this week`} />
              <span>{household.rings.toLocaleString()}</span>
            </span>
          )}
        {economyOn && (
          <button type="button" className="fitness-momentum__gems-chip" onClick={() => setBoard({ focus: null })} aria-label="Open the gem board">
            <GemIcon size="1.1em" />
            <span>Gems</span>
          </button>
        )}
      </div>

      {/* Only show the empty-state once we KNOW there's no data — never during load. */}
      {!loading && !anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no rings yet this week.</div>
      )}

      {/* --cols lets the stylesheet size everything to one person's column. */}
      <div className="fitness-momentum__cards" style={{ '--cols': Math.max(1, members.length) }}>
        {members.map((m) => (
          <div key={m.id} className="fitness-momentum__card">
            {/* The name is a tag over the avatar's lower edge. */}
            <span className="fitness-momentum__who">
              <Avatar id={m.avatarId} name={m.name} />
              <span className="fitness-momentum__name">{nameById.get(m.id) || m.name}</span>
            </span>
            <Hero rings={m.rings} loading={loading} />
            <WeekBars weeks={m.weeks} loading={loading} />
            <Rail purse={purseById.get(m.id)} name={nameById.get(m.id) || m.name} onOpen={() => setBoard({ focus: m.id })} />
          </div>
        ))}
      </div>
      <GemBoardOverlay
        open={board != null}
        surface="fitness"
        focusLearnerId={board?.focus ?? null}
        keyRef={boardKeys}
        onClose={() => setBoard(null)}
      />
    </div>
  );
}
