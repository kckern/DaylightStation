// FitnessMomentum.jsx — one flat glass panel: a household weekly-ring headline
// (with the Gems chip, which is the area legend) plus one card per person.
// Each card, top to bottom: the avatar with its name tag, this week's rings
// (at name size), the four Monday weeks as bars (height = rings, bands = the
// green/yellow/orange/red zone breakdown) with each week's ring count above and
// its Monday ("19 Oct") below, the current week in cyan, and a rail with bank
// silver and one plain gem per area the person HOLDS gems in this week. The
// rail opens the Gem Board; it sits at the foot of the card so a child can
// reach it on the touch screen. Someone without a wallet has no rail: the card
// ends at its bars.
import React, { useMemo, useRef, useState } from 'react';
import { useScreenData } from "../../../../../../__capabilities/screen-host/browser/data.mjs";
import { useFitnessScreen } from "../../useFitnessScreen.js";
import { resolveUserDisplayName } from "../../hooks/fitness/DisplayNameResolver.js";
import RingIcon from '@/lib/icons/RingIcon.jsx';
import CoinIcon from '@/lib/icons/CoinIcon.jsx';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import { AREAS, AREA_COLORS, AREA_WORDS } from '@/lib/economy/GemBoard/AreaIcon.jsx';
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '19 Oct' label from an epoch-ms window start (local date): no slash for a child to misread. */
export function dayLabel(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Stable per-bar skeleton heights (deterministic so it doesn't twitch each frame).
const SKELETON_HEIGHTS = [42, 64, 38, 72, 50, 60, 46, 68];

/**
 * One week: its ring count above, a vertical log-stacked bar (height = rings vs
 * the person's best week), and its Monday as '19 Oct' below. The current week
 * is marked on the column: cyan count and date, and a full-brightness fill.
 */
function WeekBar({ week, maxRings, index, loading }) {
  const fillPct = loading
    ? SKELETON_HEIGHTS[index % SKELETON_HEIGHTS.length]
    : (maxRings > 0 ? (week.rings / maxRings) * 100 : 0);
  const fracs = loading ? [] : zoneFractions(week.zones);
  const current = week.current && !loading ? ' is-current' : '';
  return (
    <span className={`fitness-momentum__weekcol${current}`}>
      {/* A no-break space while loading keeps the count's line, so nothing reflows on hydrate. */}
      <span className={`fitness-momentum__weektop${current}`}>{loading ? '\u00a0' : week.rings.toLocaleString()}</span>
      <span className="fitness-momentum__weekbar" title={loading ? '' : `${week.rings.toLocaleString()} rings`}>
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
      <span className={`fitness-momentum__weeklabel${current}`}>{dayLabel(week.startMs) || '\u00a0'}</span>
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

/**
 * The areas a person HOLDS gems in this week (`purse.gems`, rolled up by the
 * server in Move · School · Games order). held = earned, plus a contest gem
 * while leading: what the Gem Board draws solid. A running day-count or a zero
 * never reaches this list; anything malformed is dropped rather than drawn.
 */
export function heldChips(purse) {
  return (Array.isArray(purse?.gems) ? purse.gems : [])
    .filter((g) => AREAS.includes(g?.area) && Number.isInteger(g.held) && g.held > 0 && typeof g.color === 'string');
}

/**
 * The foot of a card: bank silver, then one token per area with gems held this
 * week. Every token is its picture over its count (the coin over the silver, a
 * plain gem in the area's colour over its number), so the counts sit on one
 * line. Area identity is the colour; the headline's Gems chip is the legend.
 * A child with nothing held shows silver alone. One button, opening the board
 * on this person. Someone without a wallet gets no rail at all (see the card).
 */
function Rail({ purse, name, onOpen }) {
  const chips = heldChips(purse);
  const words = [
    `${name}: ${purse.silver} silver`,
    ...chips.map((g) => `${AREA_WORDS[g.area]}: ${g.held} ${g.held === 1 ? 'gem' : 'gems'} this week`),
  ].join('. ');
  return (
    <button type="button" className="fitness-momentum__rail" aria-label={`${words}. Open the gem board`} onClick={onOpen}>
      <span className="fitness-momentum__silver">
        <CoinIcon metal="silver" size="1em" className="fitness-momentum__coin" />
        <span className="fitness-momentum__count">{purse.silver}</span>
      </span>
      {chips.map((g) => (
        <span key={g.area} className="fitness-momentum__chip" data-area={g.area}>
          <GemIcon className="fitness-momentum__gem" color={g.color} solid size="1em" />
          <span className="fitness-momentum__count">{g.held}</span>
        </span>
      ))}
    </button>
  );
}

/** This week's rings for one person, at the size of the name above it. */
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
  // Bank silver and the gems held this week per learner (/api/v1/earnings/standings).
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
          // The area legend, and the way into the Gem Board.
          <button type="button" className="fitness-momentum__gems-chip" onClick={() => setBoard({ focus: null })} aria-label="Open the gem board">
            {AREAS.map((a) => (
              <span key={a} className="fitness-momentum__legend" data-area={a}>
                <GemIcon size="1em" color={AREA_COLORS[a]} solid />{AREA_WORDS[a]}
              </span>
            ))}
          </button>
        )}
      </div>

      {/* Only show the empty-state once we KNOW there's no data — never during load. */}
      {!loading && !anyActive && (
        <div className="fitness-momentum__zero">Let’s get moving — no rings yet this week.</div>
      )}

      {/* --cols lets the stylesheet size everything to one person's column. */}
      <div className="fitness-momentum__cards" style={{ '--cols': Math.max(1, members.length) }}>
        {/* A card without a wallet spans only the who/hero/bars rows (is-walletless),
            so it ends at its bars, which stay on the shared baseline. */}
        {members.map((m) => (
          <div key={m.id} className={`fitness-momentum__card${purseById.has(m.id) ? '' : ' is-walletless'}`}>
            {/* The name is a tag over the avatar's lower edge. */}
            <span className="fitness-momentum__who">
              <Avatar id={m.avatarId} name={m.name} />
              <span className="fitness-momentum__name">{nameById.get(m.id) || m.name}</span>
            </span>
            <Hero rings={m.rings} loading={loading} />
            <WeekBars weeks={m.weeks} loading={loading} />
            {purseById.has(m.id) && (
              <Rail purse={purseById.get(m.id)} name={nameById.get(m.id) || m.name} onOpen={() => setBoard({ focus: m.id })} />
            )}
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
