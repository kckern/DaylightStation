import { formatDistance } from './formatDistance.js';
import { formatClock } from './cycleGameLobby.js';

/**
 * 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th" … Shared by StandingsTower and the
 * POV badges (povWorld.povBadges) so rank text can never drift between panels.
 * (CycleSpeedometer keeps its own small local copy — it renders a single
 * rider's own placement, not a multi-rider ranked list, so unifying it here
 * wasn't worth the extra import for a ~6-line function.)
 */
export function ordinal(n) {
  if (!Number.isFinite(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** m:ss for a finish time in seconds (e.g. 92 → "1:32"). Round the TOTAL
 * seconds before splitting — flooring minutes then rounding the remainder
 * renders "1:60" for 119.6s (fractional finish times exist since the
 * interpolated-finish change). */
export function fmtTime(s) {
  if (!Number.isFinite(s)) return '—';
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Gap-to-next-above text for an actively-racing row (audit UX §4.1 — "I'm 2nd,
 * 12 m behind Dad"). Distance races are chasing a fixed LINE, so a raw metre
 * gap is the honest live readout. Time races close on a fixed CLOCK instead —
 * a metre gap alone doesn't say how far behind that puts you, so it's
 * projected through the pace of the rider immediately above (their current
 * speed) into a time-behind estimate: how long it would take, at that pace,
 * to close the gap. Falls back to a metre gap if the pace above isn't usable
 * (e.g. they're stopped/boxed). Shared by StandingsTower and the POV badges
 * so the two panels can never disagree.
 */
export function gapToAboveText({ winCondition, gapM, abovePaceKmh }) {
  const g = Math.max(0, Number(gapM) || 0);
  if (winCondition === 'time') {
    const mps = (Number(abovePaceKmh) || 0) / 3.6;
    if (mps > 0.15) return `−${formatClock(g / mps)}`;
  }
  return `−${formatDistance(g)}`;
}

/**
 * A genuinely finished (non-DNF, non-overtime) rider's own metric. Distance
 * races finish every rider at the SAME distance (the goal line), so distance
 * can't differentiate finishers — only finish time can. Time races finish
 * every rider at the SAME elapsed time (the goal clock), so the
 * differentiator flips: distance covered. Shared by StandingsTower and the
 * POV badges (T9 review: the POV badge used to always show distance, so every
 * finisher in a distance race displayed the identical goal distance).
 */
export function finishedMetricText({ winCondition, finishTimeS, distanceM }) {
  return winCondition === 'distance' ? fmtTime(finishTimeS) : formatDistance(distanceM);
}
