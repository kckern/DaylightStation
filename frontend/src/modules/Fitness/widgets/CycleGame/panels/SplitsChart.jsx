import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { lapCount } from '@/modules/Fitness/lib/cycleGame/lapModel.js';
import './SplitsChart.scss';

/**
 * Compact lap-splits table — laps down the rows (newest completed at the bottom),
 * one column per rider. Completed laps show the per-lap delta; a pinned footer row
 * shows the current lap counting up live (elapsedS − last crossing). Each rider's
 * best lap is highlighted. Order is read from the POV grid, so there is no ranking.
 *
 * Holds many laps without clipping: the rider header (thead) is sticky at the top,
 * the current-lap row (tfoot) is pinned at the bottom, and the completed-lap rows
 * scroll between them — auto-scrolled to the newest as laps accumulate (the kiosk
 * has no scroll input, so we pin the view to the bottom on each new lap).
 *
 * `riders[id].lapSplits` = cumulative crossing times (s); element i = end of lap i+1.
 */
export default function SplitsChart({ riderIds, riders, lapLengthM = 0, elapsedS = 0 }) {
  const scrollRef = useRef(null);
  const lapsOn = Number.isFinite(lapLengthM) && lapLengthM > 0;
  const splitsOf = (id) => riders[id]?.lapSplits || [];
  const completed = lapsOn ? Math.max(0, ...riderIds.map((id) => splitsOf(id).length)) : 0;

  // Keep the view pinned to the newest completed lap as the race adds laps.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [completed]);

  if (!lapsOn) {
    return (
      <div className="cg-splits" data-testid="race-splits">
        <div className="cg-splits__empty" data-testid="splits-empty">No laps</div>
      </div>
    );
  }

  const lapDelta = (id, i) => { const s = splitsOf(id); return i < s.length ? s[i] - (s[i - 1] || 0) : null; };
  const bestLapIdx = (id) => {
    const s = splitsOf(id); let best = -1, bestT = Infinity;
    for (let i = 0; i < s.length; i++) { const d = s[i] - (s[i - 1] || 0); if (d < bestT) { bestT = d; best = i; } }
    return best;
  };
  const currentLapRunning = (id) => {
    const s = splitsOf(id);
    return Math.max(0, elapsedS - (s[s.length - 1] || 0));
  };
  const curLapNo = (id) => lapCount(riders[id]?.cumulativeDistanceM || 0, lapLengthM) + 1;
  const best = Object.fromEntries(riderIds.map((id) => [id, bestLapIdx(id)]));

  return (
    <div className="cg-splits" data-testid="race-splits" ref={scrollRef}>
      <table className="cg-splits__table">
        <thead>
          <tr>
            <th className="cg-splits__corner" aria-hidden="true">Lap</th>
            {riderIds.map((id, idx) => (
              <th key={id} className="cg-splits__rider" data-testid="splits-rider">
                <span className="cg-splits__dot" style={{ background: LINE_COLORS[idx % LINE_COLORS.length] }} />
                {riders[id]?.displayName || id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: completed }, (_, i) => (
            <tr key={`lap-${i}`} className="cg-splits__row" data-testid="splits-lap-row">
              <th scope="row" className="cg-splits__lap">{i + 1}</th>
              {riderIds.map((id) => {
                const d = lapDelta(id, i);
                const isBest = best[id] === i;
                return (
                  <td key={id} data-testid="splits-cell"
                    className={`cg-splits__cell${isBest ? ' cg-splits__cell--best' : ''}`}>
                    {d == null ? '—' : formatClock(d)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="cg-splits__row cg-splits__row--current">
            <th scope="row" className="cg-splits__lap">{Math.max(1, ...riderIds.map(curLapNo))}•</th>
            {riderIds.map((id) => (
              <td key={id} className="cg-splits__cell cg-splits__cell--current" data-testid="splits-current">
                {formatClock(currentLapRunning(id))}…
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

SplitsChart.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  lapLengthM: PropTypes.number,
  elapsedS: PropTypes.number
};
