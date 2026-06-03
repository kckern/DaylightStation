import React from 'react';
import PropTypes from 'prop-types';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import './LapTable.scss';

const EM_DASH = '—';

/**
 * Growing per-lap split table — one row per completed lap, one column per rider.
 * Each cell is that rider's time for THAT lap (the per-lap delta vs. the previous
 * crossing), not the cumulative race time. Riders who haven't finished a given lap
 * show an em-dash placeholder. Header names are lane-colored.
 *
 * `lapSplits[id]` is the rider's cumulative crossing times in seconds — element i
 * is the moment they crossed the end of lap i+1.
 */
export default function LapTable({ riderIds, riders, lapSplits }) {
  const rowCount = Math.max(0, ...riderIds.map((id) => (lapSplits[id] || []).length));

  return (
    <table className="cg-lap-table" data-testid="lap-table">
      <thead>
        <tr>
          <th className="cg-lap-table__corner" aria-hidden="true" />
          {riderIds.map((id, idx) => (
            <th
              key={`head-${id}`}
              className="cg-lap-table__rider"
              style={{ color: LINE_COLORS[idx % LINE_COLORS.length] }}
            >
              {riders[id]?.displayName || id}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rowCount }, (_, i) => (
          <tr key={`lap-${i}`}>
            <th scope="row" className="cg-lap-table__lap">{`Lap ${i + 1}`}</th>
            {riderIds.map((id) => {
              const splits = lapSplits[id] || [];
              const done = i < splits.length;
              const lapTime = done ? splits[i] - (splits[i - 1] || 0) : null;
              return (
                <td key={`cell-${id}-${i}`} className="cg-lap-table__time">
                  {done ? formatClock(lapTime) : EM_DASH}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

LapTable.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  lapSplits: PropTypes.object.isRequired
};
