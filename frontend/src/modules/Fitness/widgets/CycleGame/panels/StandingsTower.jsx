import React from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { ordinal, gapToAboveText, finishedMetricText } from '@/modules/Fitness/lib/cycleGame/standingsFormat.js';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import './StandingsTower.scss';

const AVATAR_BASE = '/api/v1/static/img/users';
const FALLBACK_AVATAR = `${AVATAR_BASE}/user`;

// Re-exported for backward compatibility (existing tests import these named
// exports from this module) — the implementations now live in the shared
// lib/cycleGame/standingsFormat.js so PovGrid's badges can never drift.
export { ordinal, gapToAboveText };

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

/**
 * Persistent standings tower — the always-on rank/gap ladder the audit found
 * nowhere on the race screen (UX §4.1). One row per rider: rank ordinal
 * (shared placements render the same ordinal, e.g. two "1st"), lane-color
 * chip, 32px avatar (ghost-treated), truncated name, and either the
 * gap-to-next-above or — for the group leader / a finisher / an overtime-DNF
 * row — their own total/final metric. Finished riders pin to the top with a
 * flag; overtime and DNF riders sink to the bottom, dimmed.
 *
 * The header line folds in what used to be the oval's "Last / Now" lap strip
 * (audit UX §4.2 — wide mode lost all lap info once the oval was gone): it's
 * fed the SAME props OvalTrack was (`riders[id].lapSplits`, `lapLengthM`,
 * `elapsedS`, `lapLabel`), tracking the overall distance leader.
 */
export default function StandingsTower({
  riderIds = [], riders = {}, riderLive = {}, winCondition = 'distance',
  lapLengthM = 0, elapsedS = 0, lapLabel = null
}) {
  const { finishedRows, activeRows, overtimeRows, dnfRows } = buildStandingsGroups({ riderIds, riders, riderLive });

  let rankCounter = 0;
  const displayRows = [];
  finishedRows.forEach((r) => {
    rankCounter += 1;
    displayRows.push({
      r, rank: r.placement ?? rankCounter, kind: 'finished',
      displayText: finishedMetricText({ winCondition, finishTimeS: r.finishTimeS, distanceM: r.distanceM })
    });
  });
  activeRows.forEach((r, i) => {
    rankCounter += 1;
    const above = activeRows[i - 1];
    const displayText = above
      ? gapToAboveText({ winCondition, gapM: above.distanceM - r.distanceM, abovePaceKmh: above.speedKmh })
      : formatDistance(r.distanceM);
    displayRows.push({ r, rank: r.placement ?? rankCounter, kind: 'active', displayText });
  });
  overtimeRows.forEach((r) => {
    rankCounter += 1;
    displayRows.push({ r, rank: r.placement ?? rankCounter, kind: 'overtime', displayText: formatDistance(r.distanceM) });
  });
  dnfRows.forEach((r) => {
    rankCounter += 1;
    displayRows.push({ r, rank: r.placement ?? rankCounter, kind: 'dnf', displayText: 'DNF' });
  });

  // Header: the leader (furthest along, whether finished or not) drives the
  // lap number + last/current-lap timing, exactly as the oval's strip did.
  const lapsOn = Number.isFinite(lapLengthM) && lapLengthM > 0;
  const leaderId = riderIds.reduce((best, id) => (
    best == null || (riders[id]?.cumulativeDistanceM || 0) > (riders[best]?.cumulativeDistanceM || 0) ? id : best
  ), null);
  const splits = leaderId ? (riders[leaderId]?.lapSplits || []) : [];
  const lastLapS = splits.length ? splits[splits.length - 1] - (splits[splits.length - 2] || 0) : null;
  const curLapS = Math.max(0, elapsedS - (splits[splits.length - 1] || 0));

  return (
    <div className="cg-tower" data-testid="standings-tower">
      {lapsOn && (
        <div className="cg-tower__header" data-testid="tower-lap-header">
          {lapLabel && <span className="cg-tower__lap-num">{lapLabel}</span>}
          <span className="cg-tower__lap-sep" aria-hidden="true">·</span>
          <span className="cg-tower__lap-last" data-testid="tower-lap-last">
            Last {lastLapS == null ? '—' : formatClock(lastLapS)}
          </span>
          <span className="cg-tower__lap-sep" aria-hidden="true">·</span>
          <span className="cg-tower__lap-now" data-testid="tower-lap-now">Now {formatClock(curLapS)}</span>
        </div>
      )}
      <ol className="cg-tower__list">
        {displayRows.map(({ r, rank, kind, displayText }) => (
          <li
            key={r.id}
            className={`cg-tower__row${kind === 'finished' ? ' cg-tower__row--finished' : ''}${(kind === 'overtime' || kind === 'dnf') ? ' cg-tower__row--dim' : ''}`}
            data-testid="tower-row"
            data-rider={r.id}
            data-kind={kind}
          >
            <span className="cg-tower__rank" data-testid="tower-rank">{ordinal(rank)}</span>
            <span className="cg-tower__lane" style={{ background: r.color }} aria-hidden="true" />
            <span className={`cg-tower__avatar${r.isGhost ? ' cg-ghost' : ''}`}>
              <CircularUserAvatar
                name={r.displayName}
                avatarSrc={r.avatarSrc}
                fallbackSrc={FALLBACK_AVATAR}
                size={32}
                showGauge={false}
                showIndicator={false}
              />
            </span>
            <span className="cg-tower__name">{r.displayName}</span>
            <span className="cg-tower__metric" data-testid="tower-metric">
              {kind === 'finished' && <span className="cg-tower__flag" aria-hidden="true">🏁</span>}
              <span className="cg-tower__metric-text">{displayText}</span>
              {kind === 'overtime' && <span className="cg-tower__ot-tag" aria-label="overtime">OT</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

StandingsTower.propTypes = {
  riderIds: PropTypes.array,
  riders: PropTypes.object,
  riderLive: PropTypes.object,
  winCondition: PropTypes.string,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number,
  lapLabel: PropTypes.string
};
