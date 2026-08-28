// standingsGroups.js — pure rider classification for StandingsTower.jsx,
// split out so Fast Refresh can hot-reload the tower component on its own.
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';

/**
 * Pure classification: split riders into pinned-finished / actively-racing /
 * overtime / dnf groups, each sorted for display. Exported so the ranking
 * logic is directly unit-testable without rendering.
 *
 * `placement` prefers `riderLive[id].placement` (the container forwards the
 * engine's live `standings()` rank for EVERY rider, not just finishers) and
 * falls back to `riders[id].placement` (RaceRecap's decoded, persisted
 * placement) when the live field isn't wired up by the caller.
 */
export function buildStandingsGroups({ riderIds = [], riders = {}, riderLive = {} }) {
  const rows = riderIds.map((id, idx) => {
    const rider = riders[id] || {};
    const live = riderLive[id] || {};
    const distanceM = Math.round(rider.cumulativeDistanceM || 0);
    const isDnf = !!live.dnf;
    const isOvertime = !isDnf && !!live.overtime;
    const finishTimeS = Number.isFinite(rider.finishTimeS) ? rider.finishTimeS : null;
    const finished = !isDnf && !isOvertime && (!!live.finished || finishTimeS != null);
    const placement = Number.isFinite(live.placement) ? live.placement
      : (Number.isFinite(rider.placement) ? rider.placement : null);
    const ident = resolveParticipantIdentity(rider.userId || id, rider.displayName);
    return {
      id, idx, distanceM, isDnf, isOvertime, finished, finishTimeS, placement,
      isGhost: !!rider.isGhost || ident.isGhost,
      displayName: rider.displayName || ident.displayName,
      avatarSrc: live.avatarSrc || rider.avatarSrc || ident.avatarSrc,
      speedKmh: Number.isFinite(live.speedKmh) ? live.speedKmh : 0,
      color: LINE_COLORS[idx % LINE_COLORS.length]
    };
  });
  const byPlacement = (a, b) => (a.placement ?? 999) - (b.placement ?? 999);
  const byDistanceDesc = (a, b) => b.distanceM - a.distanceM;
  const finishedRows = rows.filter((r) => r.finished).sort(byPlacement);
  const activeRows = rows.filter((r) => !r.finished && !r.isDnf && !r.isOvertime)
    .sort((a, b) => byPlacement(a, b) || byDistanceDesc(a, b));
  const overtimeRows = rows.filter((r) => r.isOvertime).sort(byDistanceDesc);
  const dnfRows = rows.filter((r) => r.isDnf).sort(byDistanceDesc);
  return { finishedRows, activeRows, overtimeRows, dnfRows };
}
